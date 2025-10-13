# salakala

<p>
  <a href="https://github.com/auth70/salakala/actions"><img src="https://img.shields.io/github/actions/workflow/status/auth70/salakala/publish.yml?logo=github" alt="build"></a>
  <a href="https://www.npmjs.com/package/salakala"><img src="https://img.shields.io/npm/v/salakala" alt="npm"></a>
  <a href="https://www.npmjs.com/package/salakala"><img src="https://img.shields.io/npm/types/salakala" alt="npm type definitions"></a>
</p>

Generate environment variables from (multiple) secret providers using a JSON configuration file. Output to `.env` files or export directly to your shell. Supports JSON field access, secret synchronization between providers, and more.

```json
{
    "DATABASE_URL": "op://application-secrets/db/url",
    "API_KEY": "awssm://us-east-1/prod/api-key"
}
```

Integrates with 1Password, Bitwarden, AWS Secrets Manager, Google Cloud Secret Manager, Azure Key Vault, KeePass, and LastPass.

## Installation

Install globally to use as a regular CLI:

```bash
npm install -g salakala
```

Or install in your project:

```bash
npm install --save-dev salakala
```

and then add a script to your `package.json`:

```json
"scripts": {
    "salakala": "salakala"
}
```

## Usage

Create a `salakala.json` configuration file in your project root, then run salakala to fetch secrets and generate environment variables.

### Basic Commands

```bash
salakala                    # Generate .env file in current directory
salakala -s                 # Export variables to current shell
salakala -e staging         # Use specific environment configuration
salakala -i config.json     # Use alternative input file
salakala -o .env.local      # Write to alternative output file
salakala -w                 # Overwrite existing file instead of merging
salakala --help             # Show help
```

### Configuration

<details>
<summary><b>Basic Configuration</b></summary>

Flat structure for single-environment setups:

```json
{
    "DATABASE_URL": "op://vault/database/url",
    "API_KEY": "awssm://us-east-1/prod/api-key"
}
```
</details>

<details>
<summary><b>Multi-Environment Configuration</b></summary>

Nested structure for environment-specific secrets:

```json
{
    "development": {
        "DATABASE_URL": "op://vault/dev-database/url",
        "API_KEY": "awssm://us-east-1/dev/api-key"
    },
    "production": {
        "DATABASE_URL": "op://vault/prod-database/url",
        "API_KEY": "awssm://us-east-1/prod/api-key"
    }
}
```
</details>

<details>
<summary><b>Environment Variable Substitution</b></summary>

Use `${VARIABLE_NAME}` syntax to reference environment variables in secret paths:

```json
{
    "development": {
        "API_KEY": "gcsm://projects/${PROJECT_ID}/secrets/api-key/versions/latest"
    }
}
```

Ensure variables are set before execution:

```bash
PROJECT_ID=my-project salakala
```
</details>

<details>
<summary><b>Non-Secret Values</b></summary>

Include static configuration alongside secrets. Values without provider prefixes are passed through unchanged:

```json
{
    "DB_PASSWORD": "op://vault/database/password",
    "APP_NAME": "My Application",
    "LOG_LEVEL": "info"
}
```
</details>

<details>
<summary><b>JSON Field Access</b></summary>

Extract specific fields from JSON-structured secrets using the `::` separator.

**Syntax:**
```
provider://path/to/secret::jsonKey
```

The `::` separator instructs salakala to fetch the secret, parse it as JSON, extract the specified field, and return it as a string.

**Supported patterns:**
- Simple key: `::username`
- Nested object: `::database.host` or `::api.credentials.key`
- Array index: `::servers[0]` or `::endpoints[1].url`
- First array item: `::items[]`

**Example:**

Given a secret containing:

```json
{
  "database": {
    "host": "localhost",
    "credentials": {
      "username": "admin", 
      "password": "secret123"
    }
  },
  "servers": ["web1", "web2", "api"]
}
```

Extract specific fields:

```json
{
  "DB_HOST": "op://vault/config::database.host",
  "DB_USER": "op://vault/config::database.credentials.username",
  "DB_PASS": "op://vault/config::database.credentials.password",
  "WEB_SERVER": "op://vault/config::servers[0]"
}
```
</details>

## Secret Synchronization

Synchronize secrets across multiple providers using `src` and `dst` configuration.

### Configuration

```json
{
  "production": {
    "src": {
      "API_KEY": "op://vault/api-key/password",
      "DATABASE_URL": "op://vault/database/connection-string"
    },
    "dst": {
      "API_KEY": [
        "gcsm://projects/my-project/secrets/api-key/versions/latest"
      ],
      "DATABASE_URL": [
        "gcsm://projects/my-project/secrets/db-url/versions/latest",
        "awssm://us-east-1/prod/database-url"
      ]
    }
  }
}
```

- `src`: Source provider URIs for reading secrets
- `dst`: Destination provider URIs for writing secrets (supports multiple destinations per secret)
- Only secrets defined in `dst` will be synchronized

### Commands

```bash
salakala sync                # Sync all secrets in dst
salakala sync -e production  # Sync specific environment
salakala sync -s API_KEY     # Sync single secret
salakala sync --dry-run      # Preview changes without writing
salakala sync -y             # Skip prompts and overwrite (for CI/automation)
```

### Conflict Resolution

When a secret exists at the destination, you will be prompted unless using the `-y` flag:

- **Y** - Overwrite this secret
- **N** - Skip this secret  
- **D** - Show diff between current and new value
- **A** - Overwrite all remaining conflicts
- **Q** - Quit synchronization

Use `salakala sync -y` in CI/CD pipelines to automatically overwrite without prompts.

## Providers

<details>
<summary><b>1Password</b> <code>op://</code></summary>

**Requirements:** 1Password CLI (`op`)

**Features:**
- Tested in CI
- Interactive login
- Non-interactive login via environment variables
- Write support
- JSON field access

**Format:**
```
op://vault-name/item-name/[section-name/]field-name[::jsonKey]
```

**Example:**
```
op://Personal/AWS/access-key
op://Development/config/database::host
```

</details>

<details>
<summary><b>Bitwarden</b> <code>bw://</code></summary>

**Requirements:** Bitwarden CLI (`bw`)

**Features:**
- Tested in CI
- Interactive login
- Non-interactive login via environment variables
- Write support

**Format:**
```
bw://[folder]/item-name-or-id/field[::json-key]
```

**Examples:**

Access by item ID:
```
bw://1c9448b3-3d30-4f01-8d3c-3a4b8d14d00a/password
```

Access by item name and folder:
```
bw://my-folder/my-item/password
```

Access JSON field in notes:
```
bw://my-folder/my-item/notes::foo.bar[1]
```

Access login URIs:
```
bw://my-folder/my-item/uris/0
```

</details>

<details>
<summary><b>KeePassXC</b> <code>kp://</code></summary>

**Requirements:** KeePassXC CLI (`keepassxc-cli`)

**Features:**
- Tested in CI
- Interactive login
- Non-interactive login via environment variables
- Write support (interactive mode only)
- JSON field access

**Format:**
```
kp://path/to/database.kdbx/entry-path/field[::jsonKey]
```

**Example:**
```
kp:///Users/me/secrets.kdbx/Web/GitHub/Password
kp:///Users/me/secrets.kdbx/Config/Notes::database.host
```

**Note:** Use `keepassxc-cli show "/path/to/database.kdbx" "entry-name"` to list available fields.

</details>

<details>
<summary><b>AWS Secrets Manager</b> <code>awssm://</code></summary>

**Requirements:** AWS credentials (AWS CLI or environment variables)

**Features:**
- Tested in CI
- Write support
- Uses AWS SDK (AWS CLI not required)

**Format:**
```
awssm://region/secret-name[::jsonKey]
```

**Examples:**

Plaintext secret:
```
awssm://us-east-1/prod/api-key
```

Entire JSON object:
```
awssm://us-east-1/prod/database
```

Specific JSON field:
```
awssm://us-east-1/prod/database::password
```

</details>

<details>
<summary><b>Google Cloud Secret Manager</b> <code>gcsm://</code></summary>

**Requirements:** Google Cloud credentials (gcloud CLI or service account)

**Features:**
- Tested in CI
- Write support
- Uses Google Cloud SDK (gcloud CLI not required)

**Format:**
```
gcsm://projects/project-id/secrets/secret-id/versions/version[::jsonKey]
```

**Examples:**

Plaintext secret:
```
gcsm://projects/my-project/secrets/api-key/versions/latest
```

Entire JSON object:
```
gcsm://projects/my-project/secrets/database/versions/latest
```

Specific JSON field:
```
gcsm://projects/my-project/secrets/database/versions/latest::password
```

</details>

<details>
<summary><b>Azure Key Vault</b> <code>azurekv://</code></summary>

**Requirements:** Azure credentials

**Features:**
- Needs testing
- Write support
- Uses Azure SDK
- JSON field access

**Format:**
```
azurekv://vault-name.vault.azure.net/secret-name[::jsonKey]
```

**Example:**
```
azurekv://my-vault.vault.azure.net/database-password
azurekv://my-vault.vault.azure.net/config::database.host
```

</details>

<details>
<summary><b>LastPass</b> <code>lp://</code></summary>

**Requirements:** LastPass CLI (`lpass`)

**Features:**
- Tested in CI
- Interactive login
- Non-interactive login via environment variables
- Write support
- JSON field access

**Format:**
```
lp://folder/item-name/field[::jsonKey]
```

**Example:**
```
lp://work-secrets/api-credentials/password
lp://work-secrets/config/notes::database.host
```

</details>

### Adding New Providers

Extend the `SecretProvider` class and add it to the providers map in `src/lib/SecretsManager.ts`. Contributions with tests are welcome.

## Best Practices

- Commit `salakala.json` to version control (contains only secret references, not secrets)
- Do not commit generated `.env` files
- Add `.env*` to `.gitignore`

## Acknowledgments

Thank you [1Password](https://1password.com) for sponsoring a team license used for testing.

## License

MIT
