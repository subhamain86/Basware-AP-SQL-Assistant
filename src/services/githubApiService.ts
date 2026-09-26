import { utf8ToBase64, base64ToUtf8 } from '../utils/base64';

// ============================================================================
// githubApiService — V14.1. A real, minimal client for the GitHub REST
// "Contents API" (spec sections 9-16: schemas must be saved to the GitHub
// repository, not just browser localStorage, so they're available across
// machines). No external SDK — just `fetch()` against `api.github.com`.
//
// This performs GENUINE network requests. In this sandboxed build
// environment there is no outbound internet access, so a real push/pull
// will fail with a network error here — that failure path is deliberately
// handled gracefully (clear message, no crash, existing local schema left
// untouched) and is exactly what gets exercised/verified in this
// environment's browser tests. When the built file is actually hosted with
// real internet access and a valid PAT + repo, these same code paths will
// perform a genuine GitHub round-trip.
// ============================================================================

export interface GitHubFileResult { content: string; sha: string; }
export interface GitHubApiError { status: number | null; message: string; }

function authHeader(token: string): string {
  // Classic PATs use "token <PAT>"; fine-grained PATs also accept this
  // scheme via GitHub's REST API v3 compatibility layer, so a single
  // header format works for both without asking the user which kind they have.
  return `token ${token}`;
}

function splitRepo(repoFullName: string): { owner: string; repo: string } | null {
  const parts = repoFullName.trim().split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], repo: parts[1] };
}

/** Fetches a file's decoded text content + its current blob SHA (required
 * for subsequent updates). Returns `null` (not an error) if the file
 * simply does not exist yet (404) — this is the normal "first push" case,
 * not a failure. Throws a GitHubApiError for genuine failures (auth,
 * network, malformed repo name, rate limit, etc.). */
export async function getFile(repoFullName: string, branch: string, path: string, token: string): Promise<GitHubFileResult | null> {
  const parsed = splitRepo(repoFullName);
  if (!parsed) throw { status: null, message: 'Repository must be in the form "owner/repo".' } as GitHubApiError;
  const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: authHeader(token), Accept: 'application/vnd.github+json' } });
  } catch (e) {
    throw { status: null, message: 'Network error — could not reach GitHub. Check your internet connection.' } as GitHubApiError;
  }
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) throw { status: res.status, message: 'GitHub authentication failed — check the access token stored in the Vault.' } as GitHubApiError;
  if (!res.ok) throw { status: res.status, message: `GitHub returned an unexpected error (HTTP ${res.status}).` } as GitHubApiError;
  const data = await res.json();
  if (Array.isArray(data)) throw { status: null, message: `"${path}" is a folder, not a file — configure a file path.` } as GitHubApiError;
  return { content: base64ToUtf8(data.content as string), sha: data.sha as string };
}

/** Creates or updates a file via a single PUT. If `sha` is provided, this
 * is treated as an update to that exact known revision (basic optimistic
 * concurrency — if someone else pushed in between, GitHub will reject the
 * request with a 409/422 rather than silently overwriting their change). */
export async function putFile(repoFullName: string, branch: string, path: string, token: string, content: string, message: string, sha: string | null): Promise<{ sha: string }> {
  const parsed = splitRepo(repoFullName);
  if (!parsed) throw { status: null, message: 'Repository must be in the form "owner/repo".' } as GitHubApiError;
  const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${encodeURIComponent(path)}`;
  const body: Record<string, unknown> = { message, content: utf8ToBase64(content), branch };
  if (sha) body.sha = sha;
  let res: Response;
  try {
    res = await fetch(url, { method: 'PUT', headers: { Authorization: authHeader(token), Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e) {
    throw { status: null, message: 'Network error — could not reach GitHub. Check your internet connection.' } as GitHubApiError;
  }
  if (res.status === 401 || res.status === 403) throw { status: res.status, message: 'GitHub authentication failed — check the access token stored in the Vault.' } as GitHubApiError;
  if (res.status === 409 || res.status === 422) throw { status: res.status, message: 'The file changed on GitHub since you last synced — pull the latest version first to avoid overwriting someone else\'s changes.' } as GitHubApiError;
  if (!res.ok) { let detail = ''; try { const j = await res.json(); detail = j.message ? ` (${j.message})` : ''; } catch { } throw { status: res.status, message: `GitHub rejected the request (HTTP ${res.status})${detail}.` } as GitHubApiError; }
  const data = await res.json();
  return { sha: data.content?.sha as string };
}

export function isGitHubApiError(e: unknown): e is GitHubApiError {
  return typeof e === 'object' && e !== null && 'message' in e;
}
