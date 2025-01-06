# salakala 🔒🐟

<p>
  <a href="https://github.com/auth70/salakala/actions"><img src="https://img.shields.io/github/actions/workflow/status/auth70/salakala/test.yml?logo=github" alt="build"></a>
  <a href="https://www.npmjs.com/package/salakala"><img src="https://img.shields.io/npm/v/salakala" alt="npm"></a>
  <a href="https://www.npmjs.com/package/salakala"><img src="https://img.shields.io/npm/types/salakala" alt="npm type definitions"></a>
</p>

We've all been there, sharing `.env` files in Slack to get a Javascript application quickly working on someone's local machine while feeling bad about security practices. 🫠

But teams always have a shared secret or password manager (1Password, Bitwarden, Google Secrets Manager, AWS Secrets Manager, etc)...

... and you're almost always logged in to it in some form (CLI, service account, etc), right?

What if you just had a nice little JSON file in your code repository that defined which environment variables to fetch from any manager?

```json
// salakala.json
{
    "DATABASE_URL": "op://application-secrets/db/url"
}
```

salakala does exactly that! It wraps around your secrets manager and generates environment variables from secrets you define as URIs. While logged in to the manager you're using, it should just work.

## Installation

```bash
# Install globally to use the CLI
npm install -g salakala
```

## Usage

1. Create a `salakala.json` file in your project (this file is safe to commit to your repository)
2. Run salakala to generate your `.env` file:

```bash
# Generate .env for development (default)
salakala

# Or specify an environment
salakala -e staging

# Specify a different output file
salakala -o .env.local

# Overwrite existing file instead of merging
salakala -w

# Show help
salakala --help
```

salakala is fresh and under development! Please report any issues you find. If you want to add support for a new provider, please open an issue or a PR.

### Examples

#### Flat structure (no environment specific secrets)

```json
// salakala.json
{
    "SECRET_ENV_VALUE": "op://application-secrets/test/test-section"
}
```

#### Nested structure (environment specific secrets)

```json
// salakala.json
{
    "development": {
        "SECRET_ENV_VALUE": "op://application-secrets/test/test-section"
    },
    "staging": {
        "SECRET_ENV_VALUE": "op://application-secrets/staging/test-section"
    }
}
```

#### Using environment variables in secret paths

You can use environment variables in your secret paths using `${VARIABLE_NAME}` syntax:

```json
// salakala.json
{
    "development": {
        "GCP_API_KEY": "gcsm://projects/${PROJECT_ID}/secrets/api-key/versions/latest"
    }
}
```

The environment variables must of course be set before running:

```bash
PROJECT_ID=my-project salakala
```

#### Using non-secret values

You can also include regular, non-secret values. Any value that doesn't start with a provider prefix (like `op://`, `gcsm://`, etc.) will be passed through:

```json
{
    "development": {
        "DB_PASSWORD": "op://vault/database/password",
        "APP_NAME": "My Development App",
    }
}
```

In this example:
- `DB_PASSWORD` will be fetched from the secret manager
- `APP_NAME` will be passed through directly to the generated environment variables

## Providers

<details>
<summary><b>1Password <code>(op://)</code></b></summary>

Uses the 1Password CLI to fetch secrets.

**Status:**
✅ Working; tested against a real 1Password account in CI

**Format:**

```
op://vault-name/item-name/[section-name/]field-name
```

**Example:**
```
op://Personal/AWS/access-key
```

**Requirements:**

- 1Password CLI (`op`) installed
- Logged in to 1Password CLI

</details>

<details>
<summary><b>LastPass <code>(lp://)</code></b></summary>

Uses the LastPass CLI to fetch secrets.

**Status:**
❌ Needs testing

**Format:**
```
lp://group/item-name[/field]
```

**Example:**
```
lp://Personal/AWS/api-key
```

**Requirements:**
  - LastPass CLI (`lpass`) installed
  - Logged in to LastPass CLI
</details>

<details>
<summary><b>Bitwarden <code>(bw://)</code></b></summary>

Uses the Bitwarden CLI to fetch secrets.

**Status:**
❌ Needs testing

**Format:**
```
bw://item-id/field
```

**Example:**
```
bw://9c9448b3-3d30-4e01-8d3c-3a4b8d14d00a/password
```

**Requirements:**
  - Bitwarden CLI (`bw`) installed
  - Logged in to Bitwarden CLI
</details>

<details>
<summary><b>AWS Secrets Manager <code>(awssm://)</code></b></summary>

Fetches secrets from AWS Secrets Manager.

**Status:**
✅ Working; tested against a real AWS account in CI

**Format:**
```
awssm://region/secret-name[:key]
```

**Example: Plaintext secret:**
```
awssm://us-east-1/prod/api-key
```

**Example: JSON object:**
```
awssm://us-east-1/prod/database
```

**Example: Specific key in JSON object:**
```
awssm://us-east-1/prod/database:password
```

**Requirements:**
  - AWS credentials configured (environment variables, credentials file, or IAM role)
  - Appropriate IAM permissions for `secretsmanager:GetSecretValue`

</details>

<details>
<summary><b>Google Cloud Secret Manager <code>(gcsm://)</code></b></summary>

Fetches secrets from Google Cloud Secret Manager.

**Status:**
✅ Working; tested against a real Google Cloud project in CI

**Format:**
```
gcsm://projects/project-id/secrets/secret-id/versions/version[:key]
```

**Example: Plaintext secret:**
```
gcsm://projects/my-project/secrets/api-key/versions/latest
```

**Example: JSON object:**
```
gcsm://projects/my-project/secrets/database/versions/latest
```

**Example: Specific key in JSON object:**
```
gcsm://projects/my-project/secrets/database/versions/latest:password
```

**Requirements:**
  - Google Cloud credentials configured (service account key file via GOOGLE_APPLICATION_CREDENTIALS or gcloud CLI login)
  - Appropriate IAM permissions for `secretmanager.versions.access`
</details>

<details>
<summary><b>Azure Key Vault <code>(azurekv://)</code></b></summary>

Fetches secrets from Azure Key Vault.

**Status:**
❌ Needs testing

**Format:**
```
azurekv://vault-name.vault.azure.net/secret-name
```

**Example:**
```
azurekv://my-vault.vault.azure.net/database-password
```

**Requirements:**
  - Azure credentials configured (uses DefaultAzureCredential)
  - Appropriate access policies
</details>

<details>
<summary><b>HashiCorp Vault <code>(hcv://)</code></b></summary>

Fetches secrets from HashiCorp Vault.

**Status:**
❌ Needs testing

**Format:**
```
hcv://vault-address/secret/path
```

**Example:**
```
hcv://vault.example.com:8200/secret/data/database/credentials
```

**Requirements:**
  - Vault server accessible
  - `VAULT_ADDR` and `VAULT_TOKEN` environment variables set

**Notes:**
- Supports both KV v1 and v2 secret engines

</details>

<details>
<summary><b>GitHub Secrets <code>(ghs://)</code></b></summary>

Uses the GitHub CLI to fetch repository secrets.

**Status:**
❌ Needs testing

**Format:**
```
ghs://owner/repo/secret-name
```

**Example:**
```
ghs://auth70/salakala/API_KEY
```

**Requirements:**
  - GitHub CLI (`gh`) installed
  - Logged in to GitHub CLI
  - Appropriate repository access permissions
</details>

<details>
<summary><b>Doppler <code>(doppler://)</code></b></summary>

Uses the Doppler CLI to fetch secrets.

**Status:**
❌ Needs testing

**Format:**
```
doppler://project/config/secret-name
```

**Example:**
```
doppler://my-project/dev/DATABASE_URL
```

**Requirements:**
  - Doppler CLI installed
  - Logged in to Doppler CLI (`doppler login`)
</details>

<details>
<summary><b>Infisical <code>(inf://)</code></b></summary>

Uses the Infisical CLI to fetch secrets.

**Status:**
❌ Needs testing

**Format:**
```
inf://workspace/environment/secret-name
```

**Example:**
```
inf://my-project/dev/DATABASE_URL
```

**Requirements:**
  - Infisical CLI installed
  - Logged in to Infisical CLI (`infisical login`)
</details>

<details>
<summary><b>KeePassXC <code>(kp://)</code></b></summary>

Uses the KeePassXC CLI to fetch secrets from a KeePass database.

**Status:**
✅ Working; tested against a real KeePass database in CI

**Format:**
```
kp://path/to/database.kdbx/entry-path/field
```

**Example:**
```
kp:///Users/me/secrets.kdbx/Web/GitHub/Password
```

**Requirements:**
  - KeePassXC CLI (`keepassxc-cli`) installed
  - Valid KeePass database file (.kdbx)
  - Database password will be prompted when accessing secrets

**Notes:**
- To find field titles, you can use the `keepassxc-cli` command: `keepassxc-cli show "/path/to/database.kdbx" "entry-name"`

</details>

## Recommendations

1. **Version Control**:
   - ✅ DO commit `salakala.json` - it should only contain paths to secrets, not the secrets themselves
   - ❌ DON'T commit generated `.env` files
   - Add `.env*` to your `.gitignore`

2. **Security**:
   - Use different secret paths for different environments
   - Ensure developers only have access to development secrets
   - Consider using separate vaults/groups for different environments

3. **Team Workflow**:
   - Document which secret managers your team uses (once implemented, searching through salakala.json files will show you which ones are used!)
   - Include provider setup instructions in your project README
   - Consider using a single provider per project if possible

## Contributing

Contributions are welcome! Feel free to submit issues and pull requests.

## License

MIT