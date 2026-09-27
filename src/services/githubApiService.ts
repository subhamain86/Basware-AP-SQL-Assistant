import { utf8ToBase64, base64ToUtf8 } from '../utils/base64';
import { safeString, safeTrim, isNonEmptyString } from '../utils/validation';
import type { SyncErrorCode } from '../types';
export interface GitHubFileResult { content: string; sha: string; }
export interface GitHubApiError { status: number | null; message: string; field?: string; code: SyncErrorCode; }
function authHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (isNonEmptyString(token)) headers.Authorization = `token ${token}`;
  return headers;
}
function splitRepo(repoFullNameRaw: unknown): { owner: string; repo: string } | GitHubApiError {
  const repoFullName = safeTrim(repoFullNameRaw);
  if (!repoFullName) return { status: null, message: 'Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Missing: Repository.', field: 'githubRepo', code: 'incorrect-file-path' };
  const parts = repoFullName.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { status: null, message: 'Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Repository must be in the form "owner/repo".', field: 'githubRepo', code: 'incorrect-file-path' };
  return { owner: parts[0], repo: parts[1] };
}
function isRepoError(x: { owner: string; repo: string } | GitHubApiError): x is GitHubApiError { return 'message' in x; }
/** V15.1 — getFile() now performs several additional defensive checks
 * (V15.1 requirement #4 "Remote Schema Selection") so the caller can never
 * accidentally treat a folder listing, a GitHub API metadata object, an
 * empty file, or a base64-decode failure as valid schema content:
 *  - Folder (array response) → 'incorrect-file-selection'
 *  - `data.content` missing/not-a-string → 'corrupted-file'
 *  - base64 decode failure → 'encoding-issue'
 *  - decoded content is empty/whitespace-only → 'empty-file'
 * Every GitHub-side failure (401/403/network/etc.) is tagged with a
 * specific SyncErrorCode so it can never be confused with a schema
 * validation failure OR a vault credential failure later in the chain. */
export async function getFile(repoFullNameRaw: unknown, branchRaw: unknown, pathRaw: unknown, tokenRaw: unknown): Promise<GitHubFileResult | null> {
  const parsed = splitRepo(repoFullNameRaw);
  if (isRepoError(parsed)) throw parsed;
  const branch = safeTrim(branchRaw) || 'main';
  const path = safeTrim(pathRaw);
  if (!path) throw { status: null, message: 'Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Missing: Repository Path.', field: 'githubSchemaPath', code: 'incorrect-file-path' } as GitHubApiError;
  const token = safeString(tokenRaw);
  const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
  let res: Response;
  try { res = await fetch(url, { headers: authHeaders(token) }); }
  catch (e) { throw { status: null, message: 'Network error — could not reach GitHub. Check your internet connection.', code: 'network-error' } as GitHubApiError; }
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) throw { status: res.status, message: 'GitHub authentication failed — check the access token stored in the Secret Vault, or you have hit the unauthenticated rate limit.', field: 'githubToken', code: 'github-sync-issue' } as GitHubApiError;
  if (!res.ok) throw { status: res.status, message: `GitHub returned an unexpected error (HTTP ${res.status}).`, code: 'github-sync-issue' } as GitHubApiError;
  let data: any;
  try { data = await res.json(); } catch { throw { status: null, message: 'GitHub returned a response that could not be parsed.', code: 'corrupted-file' } as GitHubApiError; }
  if (Array.isArray(data)) throw { status: null, message: `"${path}" is a folder, not a file — configure a file path.`, field: 'githubSchemaPath', code: 'incorrect-file-selection' } as GitHubApiError;
  if (typeof data?.content !== 'string') throw { status: null, message: 'The retrieved GitHub response did not contain file content — an unrelated API response may have been returned instead of the schema file.', code: 'incorrect-file-selection' } as GitHubApiError;
  const decoded = base64ToUtf8(data.content);
  if (!decoded.ok) throw { status: null, message: `Could not decode the retrieved file content: ${decoded.error}`, code: 'encoding-issue' } as GitHubApiError;
  if (decoded.value.trim().length === 0) throw { status: null, message: 'The retrieved schema file is empty.', code: 'empty-file' } as GitHubApiError;
  return { content: decoded.value, sha: safeString(data.sha, '') };
}
export async function putFile(repoFullNameRaw: unknown, branchRaw: unknown, pathRaw: unknown, tokenRaw: unknown, content: string, message: string, sha: string | null): Promise<{ sha: string }> {
  const parsed = splitRepo(repoFullNameRaw);
  if (isRepoError(parsed)) throw parsed;
  const branch = safeTrim(branchRaw) || 'main';
  const path = safeTrim(pathRaw);
  if (!path) throw { status: null, message: 'Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Missing: Repository Path.', field: 'githubSchemaPath', code: 'incorrect-file-path' } as GitHubApiError;
  const token = safeString(tokenRaw);
  if (!isNonEmptyString(token)) throw { status: null, message: 'Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Missing: Access Token.', field: 'githubToken', code: 'github-sync-issue' } as GitHubApiError;
  const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${encodeURIComponent(path)}`;
  const body: Record<string, unknown> = { message, content: utf8ToBase64(content), branch };
  if (sha) body.sha = sha;
  let res: Response;
  try { res = await fetch(url, { method: 'PUT', headers: { ...authHeaders(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch (e) { throw { status: null, message: 'Network error — could not reach GitHub. Check your internet connection.', code: 'network-error' } as GitHubApiError; }
  if (res.status === 401 || res.status === 403) throw { status: res.status, message: 'GitHub authentication failed — check the access token stored in the Secret Vault.', field: 'githubToken', code: 'github-sync-issue' } as GitHubApiError;
  if (res.status === 409 || res.status === 422) throw { status: res.status, message: 'The file changed on GitHub since you last synced — pull the latest version first to avoid overwriting someone else\'s changes.', code: 'github-sync-issue' } as GitHubApiError;
  if (!res.ok) { let detail = ''; try { const j = await res.json(); detail = j.message ? ` (${j.message})` : ''; } catch { } throw { status: res.status, message: `GitHub rejected the request (HTTP ${res.status})${detail}.`, code: 'github-sync-issue' } as GitHubApiError; }
  const data = await res.json();
  return { sha: safeString(data.content?.sha, '') };
}
export function isGitHubApiError(e: unknown): e is GitHubApiError { return typeof e === 'object' && e !== null && 'message' in e; }
