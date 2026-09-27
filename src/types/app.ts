export type Route = 'quickstart' | 'readonly' | 'cr' | 'schema-used' | 'error-rectifier' | 'settings' | 'about';
export interface NavChildItem { id: Route; label: string; icon: string; tourSelector?: string; }
export interface NavGroupItem { id: string; label: string; icon: string; children: NavChildItem[]; }
export type NavEntry = NavChildItem | NavGroupItem;
export type Theme = 'system' | 'light' | 'dark';
export interface UserConfiguration { theme: Theme; dialect: string; hasSeenWalkthrough: boolean; }
export interface WalkthroughStep { id: string; route: Route; targetSelector: string; title: string; body: string; }
export interface ToastMessage { id: string; kind: 'success' | 'error' | 'info' | 'warning'; text: string; }
export type SyncSource = 'shared-location' | 'github';
export type SyncTimeOption = 'manual' | '15m' | '30m' | '1h' | '4h' | '6h' | 'daily' | 'custom';
export interface SyncConfig { source: SyncSource; time: SyncTimeOption; customTime: string | null; }
export type SyncStatus = 'synchronized' | 'pending' | 'failed' | 'syncing' | 'never';
export type SettingsSection = 'security' | 'schema-editor' | 'schema-management' | 'synchronization' | 'vault' | 'danger';
export interface PendingConflict { id: string; schemaId: string; schemaName: string; localVersion: string; remoteVersion: string; changedPaths: string[]; remoteSchemaJson: string; detectedAt: string; }
export type SyncLogEntryKind = 'discovery' | 'push' | 'pull' | 'error' | 'suppressed';
export interface SyncLogEntry { id: string; timestamp: string; kind: SyncLogEntryKind; message: string; }
export interface StorageUsageEstimate { bytesUsed: number; approxQuotaBytes: number | null; percentUsed: number | null; }
/** NEW (V15.1) — distinct internal error taxonomies so different failure
 * classes are never confused with one another in the UI (e.g. a GitHub
 * auth failure must never be displayed as "incorrect password", and a
 * schema validation failure must never be displayed as a credential
 * error). These are INTERNAL states; user-facing text is always a clean,
 * separate message derived from the code, never a raw exception. */
export type VaultErrorCode = 'incorrect-password' | 'empty-password' | 'vault-not-initialized' | 'vault-corrupted' | 'missing-config' | 'github-auth-failed' | 'network-error' | 'encryption-error' | 'none';
export type SyncErrorCode = 'invalid-json' | 'empty-file' | 'invalid-root-structure' | 'missing-schema-name' | 'invalid-module-structure' | 'invalid-table-structure' | 'invalid-column-structure' | 'invalid-data-type' | 'invalid-relationship-structure' | 'invalid-pk-fk-definition' | 'unexpected-property-type' | 'unsupported-schema-version' | 'corrupted-file' | 'incorrect-file-path' | 'incorrect-file-selection' | 'encoding-issue' | 'github-sync-issue' | 'network-error' | 'not-found' | 'none';
