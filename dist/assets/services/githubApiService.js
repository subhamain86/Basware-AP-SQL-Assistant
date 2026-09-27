import { utf8ToBase64, base64ToUtf8 } from '../utils/base64.js';
import { safeString, safeTrim, isNonEmptyString } from '../utils/validation.js';
function authHeaders(token) {
    const headers = { Accept: 'application/vnd.github+json' };
    if (isNonEmptyString(token))
        headers.Authorization = `token ${token}`;
    return headers;
}
function splitRepo(repoFullNameRaw) {
    const repoFullName = safeTrim(repoFullNameRaw);
    if (!repoFullName)
        return { status: null, message: 'Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Missing: Repository.', field: 'githubRepo' };
    const parts = repoFullName.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1])
        return { status: null, message: 'Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Repository must be in the form "owner/repo".', field: 'githubRepo' };
    return { owner: parts[0], repo: parts[1] };
}
function isRepoError(x) { return 'message' in x; }
/** V14.7 — getFile() has always worked without a token for PUBLIC
 * repositories (GitHub allows unauthenticated GET on public repo contents,
 * just at a lower rate limit). This is deliberately exploited by
 * syncService's new `discoverPublicRegistry()` so that devices can find a
 * newly-uploaded schema WITHOUT first unlocking the password-protected
 * Secret Vault — fixing the "other device is not getting the uploaded
 * schema synced" report, since pulling previously required the vault to be
 * unlocked on every device before any discovery could happen at all. */
export async function getFile(repoFullNameRaw, branchRaw, pathRaw, tokenRaw) {
    const parsed = splitRepo(repoFullNameRaw);
    if (isRepoError(parsed))
        throw parsed;
    const branch = safeTrim(branchRaw) || 'main';
    const path = safeTrim(pathRaw);
    if (!path)
        throw { status: null, message: 'Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Missing: Repository Path.', field: 'githubSchemaPath' };
    const token = safeString(tokenRaw);
    const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
    let res;
    try {
        res = await fetch(url, { headers: authHeaders(token) });
    }
    catch (e) {
        throw { status: null, message: 'Network error — could not reach GitHub. Check your internet connection.' };
    }
    if (res.status === 404)
        return null;
    if (res.status === 401 || res.status === 403)
        throw { status: res.status, message: 'GitHub authentication failed — check the access token stored in the Secret Vault, or you have hit the unauthenticated rate limit.', field: 'githubToken' };
    if (!res.ok)
        throw { status: res.status, message: `GitHub returned an unexpected error (HTTP ${res.status}).` };
    const data = await res.json();
    if (Array.isArray(data))
        throw { status: null, message: `"${path}" is a folder, not a file — configure a file path.`, field: 'githubSchemaPath' };
    return { content: base64ToUtf8(data.content), sha: data.sha };
}
export async function putFile(repoFullNameRaw, branchRaw, pathRaw, tokenRaw, content, message, sha) {
    const parsed = splitRepo(repoFullNameRaw);
    if (isRepoError(parsed))
        throw parsed;
    const branch = safeTrim(branchRaw) || 'main';
    const path = safeTrim(pathRaw);
    if (!path)
        throw { status: null, message: 'Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Missing: Repository Path.', field: 'githubSchemaPath' };
    const token = safeString(tokenRaw);
    if (!isNonEmptyString(token))
        throw { status: null, message: 'Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Missing: Access Token.', field: 'githubToken' };
    const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${encodeURIComponent(path)}`;
    const body = { message, content: utf8ToBase64(content), branch };
    if (sha)
        body.sha = sha;
    let res;
    try {
        res = await fetch(url, { method: 'PUT', headers: { ...authHeaders(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }
    catch (e) {
        throw { status: null, message: 'Network error — could not reach GitHub. Check your internet connection.' };
    }
    if (res.status === 401 || res.status === 403)
        throw { status: res.status, message: 'GitHub authentication failed — check the access token stored in the Secret Vault.', field: 'githubToken' };
    if (res.status === 409 || res.status === 422)
        throw { status: res.status, message: 'The file changed on GitHub since you last synced — pull the latest version first to avoid overwriting someone else\'s changes.' };
    if (!res.ok) {
        let detail = '';
        try {
            const j = await res.json();
            detail = j.message ? ` (${j.message})` : '';
        }
        catch { }
        throw { status: res.status, message: `GitHub rejected the request (HTTP ${res.status})${detail}.` };
    }
    const data = await res.json();
    return { sha: data.content?.sha };
}
export function isGitHubApiError(e) { return typeof e === 'object' && e !== null && 'message' in e; }
