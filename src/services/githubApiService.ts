import { utf8ToBase64, base64ToUtf8 } from '../utils/base64';
import { safeString, safeTrim, isNonEmptyString } from '../utils/validation';
export interface GitHubFileResult { content: string; sha: string; }
export interface GitHubApiError { status: number | null; message: string; field?: string; }
function authHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (isNonEmptyString(token)) headers.Authorization = `token ${token}`;
  return headers;
}
function splitRepo(repoFullNameRaw: unknown): { owner: string; repo: string } | GitHubApiError {
  const repoFullName = safeTrim(repoFullNameRaw);
  if (!repoFullName) return { status: null, message: 'Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Missing: Repository.', field: 'githubRepo' };
  const parts = repoFullName.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { status: null, message: 'Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Repository must be in the form "owner/repo".', field: 'githubRepo' };
  return { owner: parts[0], repo: parts[1] };
}
function isRepoError(x: { owner: string; repo: string } | GitHubApiError): x is GitHubApiError { return 'message' in x; }
export async function getFile(repoFullNameRaw: unknown, branchRaw: unknown, pathRaw: unknown, tokenRaw: unknown): Promise<GitHubFileResult | null> {
  const parsed = splitRepo(repoFullNameRaw);
  if (isRepoError(parsed)) throw parsed;
  const branch = safeTrim(branchRaw) || 'main';
  const path = safeTrim(pathRaw);
  if (!path) throw { status: null, message: 'Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Missing: Repository Path.', field: 'githubSchemaPath' } as GitHubApiError;
  const token = safeString(tokenRaw);
  const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
  let res: Response;
  try { res = await fetch(url, { headers: authHeaders(token) }); }
  catch (e) { throw { status: null, message: 'Network error — could not reach GitHub. Check your internet connection.' } as GitHubApiError; }
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) throw { status: res.status, message: 'GitHub authentication failed — check the access token stored in the Secret Vault, or you have hit the unauthenticated rate limit.', field: 'githubToken' } as GitHubApiError;
  if (!res.ok) throw { status: res.status, message: `GitHub returned an unexpected error (HTTP ${res.status}).` } as GitHubApiError;
  const data = await res.json();
  if (Array.isArray(data)) throw { status: null, message: `"${path}" is a folder, not a file — configure a file path.`, field: 'githubSchemaPath' } as GitHubApiError;
  return { content: base64ToUtf8(data.content as string), sha: data.sha as string };
}
export async function putFile(repoFullNameRaw: unknown, branchRaw: unknown, pathRaw: unknown, tokenRaw: unknown, content: string, message: string, sha: string | null): Promise<{ sha: string }> {
  const parsed = splitRepo(repoFullNameRaw);
  if (isRepoError(parsed)) throw parsed;
  const branch = safeTrim(branchRaw) || 'main';
  const path = safeTrim(pathRaw);
  if (!path) throw { status: null, message: 'Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Missing: Repository Path.', field: 'githubSchemaPath' } as GitHubApiError;
  const token = safeString(tokenRaw);
  if (!isNonEmptyString(token)) throw { status: null, message: 'Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Missing: Access Token.', field: 'githubToken' } as GitHubApiError;
  const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${encodeURIComponent(path)}`;
  const body: Record<string, unknown> = { message, content: utf8ToBase64(content), branch };
  if (sha) body.sha = sha;
  let res: Response;
  try { res = await fetch(url, { method: 'PUT', headers: { ...authHeaders(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch (e) { throw { status: null, message: 'Network error — could not reach GitHub. Check your internet connection.' } as GitHubApiError; }
  if (res.status === 401 || res.status === 403) throw { status: res.status, message: 'GitHub authentication failed — check the access token stored in the Secret Vault.', field: 'githubToken' } as GitHubApiError;
  if (res.status === 409 || res.status === 422) throw { status: res.status, message: 'The file changed on GitHub since you last synced — pull the latest version first to avoid overwriting someone else\'s changes.' } as GitHubApiError;
  if (!res.ok) { let detail = ''; try { const j = await res.json(); detail = j.message ? ` (${j.message})` : ''; } catch { } throw { status: res.status, message: `GitHub rejected the request (HTTP ${res.status})${detail}.` } as GitHubApiError; }
  const data = await res.json();
  return { sha: data.content?.sha as string };
}
export function isGitHubApiError(e: unknown): e is GitHubApiError { return typeof e === 'object' && e !== null && 'message' in e; }
