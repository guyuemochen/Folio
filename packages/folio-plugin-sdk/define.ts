/**
 * {@link definePlugin} — the only runtime helper plugin authors call.
 *
 * It's an identity function at runtime: pass your plugin entry, get it back.
 * The value is purely ergonomic + type-narrowing: in TS it constrains the
 * shape to `FolioPluginEntry`, catching manifest mistakes at author time
 * without forcing authors to write the type annotation themselves.
 *
 *     export default definePlugin({
 *       id: 'my-plugin',
 *       name: 'My Plugin',
 *       version: '1.0.0',
 *       component: MyWidget,
 *     });
 *
 * NOTE: `definePlugin` does NOT validate at runtime. The host loader
 * validates the manifest shape after dynamic-import; bad shapes show up as
 * a load error in the plugin manager, not as a silent misbehavior.
 */
import type { FolioPluginEntry } from './types';

export function definePlugin<T extends FolioPluginEntry>(entry: T): T {
  return entry;
}
