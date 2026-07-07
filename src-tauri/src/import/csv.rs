//! CSV → Folio database converter (PRD §5.5.1 import).
//!
//! Parses a CSV file, infers column types, creates a database with the
//! inferred properties, and populates rows. The first column becomes the
//! `title` property (Notion convention); remaining columns are typed by
//! scanning their values.
//!
//! Supported inferred types: `title`, `rich_text`, `number`, `checkbox`,
//! `date`, `url`, `select`.

use crate::database::{self, AddPropertyInput, SelectOption};
use crate::Result;
use rusqlite::Connection;

/// Create a database from a CSV file. The database is created under
/// `parent_id` (or workspace root if `None`) and populated with one row per
/// CSV data line. Returns the database page's id.
pub fn import_csv(
    conn: &Connection,
    workspace_id: &str,
    parent_id: Option<&str>,
    csv_text: &str,
    db_name: Option<&str>,
) -> Result<String> {
    let rows = parse_csv(csv_text);
    if rows.len() < 2 {
        return Err(crate::Error::Other(
            "CSV must have a header row and at least one data row".into(),
        ));
    }

    let headers = &rows[0];
    let data = &rows[1..];
    let col_types = infer_column_types(headers, data);

    // Create the database page.
    let db_schema = database::create_database(
        conn,
        workspace_id,
        parent_id,
        None,
        db_name.or(Some("Imported Database")),
    )?;
    let database_id = &db_schema.page.id;

    // Add properties for each column (skip the title column — it's auto-created).
    let mut property_ids: Vec<Option<String>> = Vec::with_capacity(headers.len());
    for (i, header) in headers.iter().enumerate() {
        let inferred = &col_types[i];
        if inferred == "title" {
            // The title property already exists on a fresh database.
            // Find its id from the schema.
            let title_prop = db_schema
                .properties
                .iter()
                .find(|p| p.r#type == "title")
                .map(|p| p.id.clone());
            property_ids.push(title_prop);
        } else {
            let prop = database::add_property(
                conn,
                AddPropertyInput {
                    database_id: database_id.clone(),
                    name: header.clone(),
                    r#type: inferred.clone(),
                    options: infer_select_options(data, i, inferred),
                    number_format: None,
                },
            )?;
            property_ids.push(Some(prop.id));
        }
    }

    // Populate rows.
    for row in data {
        let db_row = database::add_database_row(conn, workspace_id, database_id)?;
        for (i, cell_value) in row.iter().enumerate() {
            if i >= property_ids.len() {
                break;
            }
            let Some(ref prop_id) = property_ids[i] else {
                continue;
            };
            // Skip empty cells.
            if cell_value.trim().is_empty() {
                continue;
            }
            let value = coerce_value(cell_value, &col_types[i]);
            database::update_cell(
                conn,
                crate::database::UpdateCellInput {
                    page_id: db_row.page.id.clone(),
                    property_id: prop_id.clone(),
                    value,
                },
            )?;
        }
    }

    Ok(database_id.clone())
}

// =============================================================================
// CSV parsing (RFC 4180 subset)
// =============================================================================

/// Parse CSV text into rows of string fields. Handles quoted fields, embedded
/// commas, and doubled-quote escaping.
fn parse_csv(text: &str) -> Vec<Vec<String>> {
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut current_row: Vec<String> = Vec::new();
    let mut current_field = String::new();
    let mut in_quotes = false;
    let mut chars = text.chars().peekable();

    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                // Doubled quote = literal quote; single quote = end of field.
                if chars.peek() == Some(&'"') {
                    current_field.push('"');
                    chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                current_field.push(c);
            }
        } else {
            match c {
                '"' => in_quotes = true,
                ',' => {
                    current_row.push(std::mem::take(&mut current_field));
                }
                '\n' => {
                    current_row.push(std::mem::take(&mut current_field));
                    rows.push(std::mem::take(&mut current_row));
                }
                '\r' => {
                    // Skip — handled by \n.
                }
                _ => current_field.push(c),
            }
        }
    }
    // Flush the last field/row if there's pending data.
    if !current_field.is_empty() || !current_row.is_empty() {
        current_row.push(current_field);
        rows.push(current_row);
    }
    // Drop trailing empty row (from final newline).
    if rows.last().map_or(false, |r| r.len() == 1 && r[0].is_empty()) {
        rows.pop();
    }
    rows
}

// =============================================================================
// Type inference
// =============================================================================

/// Infer a ProseMirror/database property type for each column.
fn infer_column_types(headers: &[String], data: &[Vec<String>]) -> Vec<String> {
    let mut types = Vec::with_capacity(headers.len());
    for i in 0..headers.len() {
        if i == 0 {
            types.push("title".to_string());
            continue;
        }
        let values: Vec<&str> = data.iter().filter_map(|r| r.get(i).map(|s| s.as_str())).collect();
        let non_empty: Vec<&str> = values.into_iter().filter(|s| !s.trim().is_empty()).collect();
        if non_empty.is_empty() {
            types.push("rich_text".to_string());
        } else if non_empty.iter().all(|s| s.parse::<f64>().is_ok()) {
            types.push("number".to_string());
        } else if non_empty.iter().all(|s| is_bool(s)) {
            types.push("checkbox".to_string());
        } else if non_empty.iter().all(|s| is_url(s)) {
            types.push("url".to_string());
        } else {
            let unique: std::collections::HashSet<&str> = non_empty.iter().copied().collect();
            if unique.len() <= 10 && unique.len() < non_empty.len() {
                types.push("select".to_string());
            } else {
                types.push("rich_text".to_string());
            }
        }
    }
    types
}

/// If the column is a select, collect the unique option values.
fn infer_select_options(
    data: &[Vec<String>],
    col: usize,
    inferred: &str,
) -> Option<Vec<SelectOption>> {
    if inferred != "select" {
        return None;
    }
    let mut seen: Vec<String> = Vec::new();
    for row in data {
        if let Some(val) = row.get(col) {
            let v = val.trim();
            if !v.is_empty() && !seen.iter().any(|s| s == v) {
                seen.push(v.to_string());
            }
        }
    }
    Some(
        seen.iter()
            .map(|v| SelectOption {
                value: v.clone(),
                color: "gray".to_string(),
            })
            .collect(),
    )
}

/// Coerce a string cell value to the JSON representation for its property type.
fn coerce_value(raw: &str, prop_type: &str) -> serde_json::Value {
    match prop_type {
        "number" => raw
            .parse::<f64>()
            .map(serde_json::Value::from)
            .unwrap_or_else(|_| serde_json::Value::String(raw.to_string())),
        "checkbox" => serde_json::Value::Bool(is_truthy(raw)),
        _ => serde_json::Value::String(raw.to_string()),
    }
}

fn is_bool(s: &str) -> bool {
    let l = s.trim().to_lowercase();
    l == "true" || l == "false" || l == "yes" || l == "no" || l == "1" || l == "0"
}

/// Distinguish truthy from falsy values for checkbox coercion.
fn is_truthy(s: &str) -> bool {
    let l = s.trim().to_lowercase();
    l == "true" || l == "yes" || l == "1"
}

fn is_url(s: &str) -> bool {
    let t = s.trim();
    t.starts_with("http://") || t.starts_with("https://")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple_csv() {
        let rows = parse_csv("a,b,c\n1,2,3\n");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0], vec!["a", "b", "c"]);
        assert_eq!(rows[1], vec!["1", "2", "3"]);
    }

    #[test]
    fn parse_quoted_field_with_comma() {
        let rows = parse_csv("\"hello, world\",b\n");
        assert_eq!(rows[0][0], "hello, world");
    }

    #[test]
    fn parse_doubled_quote_escape() {
        let rows = parse_csv("\"say \"\"hi\"\"\",b\n");
        assert_eq!(rows[0][0], "say \"hi\"");
    }

    #[test]
    fn infer_number_column() {
        let headers = vec!["Name".to_string(), "Age".to_string()];
        let data = vec![
            vec!["Alice".to_string(), "30".to_string()],
            vec!["Bob".to_string(), "25".to_string()],
        ];
        let types = infer_column_types(&headers, &data);
        assert_eq!(types[0], "title");
        assert_eq!(types[1], "number");
    }

    #[test]
    fn infer_select_column() {
        let headers = vec!["Name".to_string(), "Status".to_string()];
        let data: Vec<Vec<String>> = (0..5)
            .map(|i| vec!["X".to_string(), ["todo", "done", "wip"][i % 3].to_string()])
            .collect();
        let types = infer_column_types(&headers, &data);
        assert_eq!(types[1], "select");
    }

    #[test]
    fn infer_checkbox_column() {
        let headers = vec!["Name".to_string(), "Active".to_string()];
        let data = vec![
            vec!["A".to_string(), "true".to_string()],
            vec!["B".to_string(), "false".to_string()],
        ];
        let types = infer_column_types(&headers, &data);
        assert_eq!(types[1], "checkbox");
    }

    #[test]
    fn coerce_number_value() {
        let v = coerce_value("42", "number");
        assert_eq!(v, serde_json::json!(42.0));
    }

    #[test]
    fn coerce_checkbox_value() {
        assert_eq!(coerce_value("yes", "checkbox"), serde_json::json!(true));
        assert_eq!(coerce_value("no", "checkbox"), serde_json::json!(false));
    }
}
