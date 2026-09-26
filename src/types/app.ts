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
