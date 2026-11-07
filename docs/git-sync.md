# Git Sync — credentials

Git sync pushes your documentation and diagrams to a git repository you own. It
only needs **write access to that one repository**. This page shows how to get a
credential on GitHub and GitLab and how to set it in `.env`.

> 🔒 **Server-dependent feature**: it needs the Homelable backend and is hidden in
> the standalone build.

> ⚠️ Documents can contain internal addresses and credentials. **Use a private
> repository.**

---

## Which credential?

| | HTTPS + token | SSH + deploy key |
|---|---|---|
| Scope | Whatever the token is granted (limit it to one repo) | Always exactly one repository |
| Expires | Yes, on GitHub and GitLab (renew it) | No |
| Setup | Paste one value into `.env` | Generate a key and mount it into the container |
| Works behind a proxy that only allows 443 | Yes | Only if the host offers SSH on 443 |

Both are fine. A token is quicker to set up. A deploy key never expires and can't
reach any other repository.

Before you start, create the repository (it can be empty) and decide which branch
to push to (default `main`).

---

## GitHub

### Option A: fine-grained personal access token (HTTPS)

1. Go to **Settings → Developer settings → Personal access tokens → Fine-grained
   tokens → Generate new token**
   (<https://github.com/settings/personal-access-tokens/new>).
2. **Token name**: `homelable`. **Expiration**: pick a date and note it, because
   the sync fails once the token expires.
3. **Resource owner**: your account, or the organisation that owns the repository.
   An organisation may need to approve the token first.
4. **Repository access → Only select repositories** → pick the repository.
5. **Permissions → Repository permissions → Contents → Read and write**.
   GitHub adds *Metadata: Read-only* on its own. Nothing else is needed.
6. **Generate token**, then copy it (`github_pat_…`). GitHub only shows it once.

```env
GIT_SYNC_REPO_URL=https://github.com/you/homelab.git
GIT_SYNC_BRANCH=main
GIT_SYNC_TOKEN=github_pat_xxxxxxxxxxxxxxxx
```

GitHub ignores the username sent with a token, so leave `GIT_SYNC_USERNAME`
unset. A classic token (`ghp_…`) with the `repo` scope also works, but it can
write to **every** repository you have access to, so prefer a fine-grained token.

If the branch is protected (*Settings → Branches* or *Rules*), allow pushes from
your account, or point `GIT_SYNC_BRANCH` at a branch that isn't protected.

### Option B: deploy key (SSH)

1. Generate a key with no passphrase (the sync runs without anyone there to type
   one):

   ```bash
   ssh-keygen -t ed25519 -N "" -C "homelable git sync" -f git-sync-key
   ```

2. In the repository: **Settings → Deploy keys → Add deploy key**. Paste
   `git-sync-key.pub`, and **tick "Allow write access"**.
3. Set it up as described in [Installing the SSH key](#installing-the-ssh-key) below, then:

```env
GIT_SYNC_REPO_URL=git@github.com:you/homelab.git
GIT_SYNC_BRANCH=main
GIT_SYNC_SSH_KEY=/app/data/git-sync-key
```

---

## GitLab

The same steps apply to gitlab.com and to a self-hosted GitLab (use your own host
name in the URLs).

### Option A: project access token (HTTPS), recommended

A project access token only reaches one project. It needs GitLab Premium on
gitlab.com, but is free on self-managed instances. If you can't create one, use
Option B.

1. In the project: **Settings → Access tokens → Add new token**.
2. **Token name**: `homelable`. Set an **expiration date** (GitLab requires one,
   up to a year by default).
3. **Role**: **Developer** is enough for an unprotected branch. Use
   **Maintainer** to push to a protected branch (like `main`, by default), or
   allow Developers to push under *Settings → Repository → Protected branches*.
4. **Scopes**: **`write_repository`** only.
5. **Create project access token** and copy it (`glpat-…`).

```env
GIT_SYNC_REPO_URL=https://gitlab.com/you/homelab.git
GIT_SYNC_BRANCH=main
GIT_SYNC_TOKEN=glpat-xxxxxxxxxxxxxxxx
```

GitLab accepts any non-empty username with a token, so the default `git` works.

### Option B: personal access token (HTTPS)

**User settings → Access tokens → Add new token**
(<https://gitlab.com/-/user_settings/personal_access_tokens>), scope
**`write_repository`**, with an expiration date. Set it the same way as Option A.
It reaches every project you can push to, so keep it to this one use.

### Option C: deploy key (SSH)

1. Generate the key as in the GitHub section (`ssh-keygen -t ed25519 -N "" …`).
2. In the project: **Settings → Repository → Deploy keys → Add new key**. Paste
   the `.pub` file, and **tick "Grant write permissions to this key"**.
3. A deploy key can't push to a protected branch unless you allow it under
   *Settings → Repository → Protected branches → Allowed to push and merge*. You
   can also use a branch that isn't protected.
4. Install the key as described in [Installing the SSH key](#installing-the-ssh-key), then:

```env
GIT_SYNC_REPO_URL=git@gitlab.com:you/homelab.git
GIT_SYNC_BRANCH=main
GIT_SYNC_SSH_KEY=/app/data/git-sync-key
```

> GitLab **deploy tokens** can't push (they are read-only for repositories). Use
> a deploy key or an access token instead.

---

## Installing the SSH key

The backend has to be able to read the private key. With Docker Compose, the
simplest way is to put it on the backend's data volume:

```bash
docker compose cp git-sync-key backend:/app/data/git-sync-key
docker compose exec backend chmod 600 /app/data/git-sync-key
```

You can also bind-mount it in `docker-compose.yml`
(`- ./git-sync-key:/app/data/git-sync-key:ro`). On a bare-metal or LXC install,
store it anywhere the backend user can read it and set `GIT_SYNC_SSH_KEY` to that
path. SSH refuses keys that other users can read, so keep it at `chmod 600`.

On the first sync, Homelable records the server's host key in
`<data>/git-sync-known_hosts`. If that key changes later, the sync fails instead
of trusting the new key. If the change is legitimate (you moved the server),
delete that file.

---

## Apply and test

1. Restart the backend so it picks up `.env` (`docker compose up -d backend`).
2. Open **Settings → Git sync**. It shows the repository, the branch, the folder
   and the auth method it detected (*HTTPS token* or *SSH key*).
3. Click **Sync now** (or the **Sync** button in the header). A success toast
   shows the short commit hash.

---

## Troubleshooting

| Error | Cause / fix |
|---|---|
| `Authentication failed` / `403` / `HTTP Basic: Access denied` | Token wrong or expired, missing *Contents: write* (GitHub) or `write_repository` (GitLab), or the token doesn't cover this repository. |
| `protected branch` / `GH006` / `pre-receive hook declined` | The branch is protected: allow the token's user or the deploy key to push, or sync to another branch. |
| `Permission denied (publickey)` | The deploy key wasn't added to this repository, or the backend can't read `GIT_SYNC_SSH_KEY` (check the path inside the container and `chmod 600`). |
| `The key you are authenticating with has been marked as read only` | The deploy key was added without write access. Edit it and tick write access. |
| `Host key verification failed` | The server's host key changed since the first sync. Check why, then delete `<data>/git-sync-known_hosts`. |
| `The remote branch moved during the sync` | Someone pushed while the sync was running. Click Sync again. |

The token is never written to disk by Homelable, never shown in the UI and never
logged. It is sent to git through an environment variable for each push and
removed from any error message.

## Rotating a credential

Create the new token or key, update `.env` (or replace the key file), then restart
the backend. After that, revoke the old token or key on GitHub/GitLab. Nothing
else needs to change.
