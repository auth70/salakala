# salakala 🔒🐟

<p>
  <a href="https://github.com/auth70/salakala/actions"><img src="https://img.shields.io/github/actions/workflow/status/auth70/salakala/test.yml?logo=github" alt="build"></a>
  <a href="https://www.npmjs.com/package/salakala"><img src="https://img.shields.io/npm/v/salakala" alt="npm"></a>
  <a href="https://www.npmjs.com/package/salakala"><img src="https://img.shields.io/npm/types/salakala" alt="npm type definitions"></a>
</p>

We've all been there, sharing `.env` files in Slack to get an application working quickly while feeling bad about security practices. 🫠

But teams always have a shared secret or password manager, and you already have a way to access it through a CLI or service account, right?

What if you just had a nice little JSON file in your code repository that defined which environment variables to fetch from any manager through URIs?

```json
// salakala.json
{
    "DATABASE_URL": "op://application-secrets/db/url"
}
```

salakala does exactly that! It wraps around your manager and generates environment variables for you as `.env` files or by setting variables directly in your environment.

## Installation

```bash
# Install globally to use the CLI
npm install -g salakala
```

## Usage

1. Create a `salakala.json` file in your project (safe to commit to your repository!)
2. Run salakala to generate your `.env` file or set environment variables:

```bash
# Generate .env file in the current directory (default)
salakala

# Set environment variables in the current shell
salakala -s

# Specify an environment
salakala -e staging

# Specify a different output file
salakala -o .env.local

# Overwrite existing file instead of merging
salakala -w

# Show help
salakala --help
```

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

<hr>

Uses the 1Password CLI to fetch secrets. Requires the `op` CLI to be installed.

- ✅ Tested against a real 1Password account in CI
- 🧑‍💻 Interactive login via invoking `op`
- 🤖 Noninteractive login using environment variables

**Format:**

```
op://vault-name/item-name/[section-name/]field-name
```

**Example:**
```
op://Personal/AWS/access-key
```
<hr>

</details>

<details>
<summary><b>Bitwarden <code>(bw://)</code></b></summary>

<hr>

Uses the Bitwarden CLI (`bw`) to fetch secrets. Requires the `bw` CLI to be installed. Supports different vault locations.

- ✅ Tested against a real Bitwarden account in CI
- 🧑‍💻 Interactive login via invoking `bw`
- 🤖 Noninteractive login using environment variables

**Format:**
```
bw://[folder]/item-name-or-id/field::json-key
```

**Example: Plaintext field via item ID:**
```
bw://1c9448b3-3d30-4f01-8d3c-3a4b8d14d00a/password
```

**Example: Plaintext field via item name:**
```
bw://my-folder/my-item/password
```

**Example: JSON field via item name:**
```
bw://my-folder/my-item/notes::foo.bar[1]
```
<small><i>This expects that the item has a `notes` field that is a JSON object. It will return the value of the `foo.bar[1]` key.</i></small>

**Example: URI from a login item:**
```
bw://my-folder/my-item/uris/0
```
<small><i>This would get the first URI from the `uris` field.</i></small>
<hr>
</details>

<details>
<summary><b>KeePassXC <code>(kp://)</code></b></summary>

<hr>
Uses the KeePassXC CLI to fetch secrets from a KeePass database. Requires the `keepassxc-cli` CLI to be installed.

- ✅ Tested against a real KeePass database in CI
- 🧑‍💻 Interactive login via invoking `keepassxc-cli`
- 🤖 Noninteractive login using environment variables

**Format:**
```
kp://path/to/database.kdbx/entry-path/field
```

**Example:**
```
kp:///Users/me/secrets.kdbx/Web/GitHub/Password
```

**Notes:**
- To find field titles, you can use the `keepassxc-cli` command: `keepassxc-cli show "/path/to/database.kdbx" "entry-name"`

<hr>
</details>

<details>
<summary><b>AWS Secrets Manager <code>(awssm://)</code></b></summary>

<hr>

Fetches secrets from AWS Secrets Manager. Requires some form of AWS credentials to be configured. Uses the AWS SDK to fetch secrets.

- ✅ Tested against a real AWS account in CI
- 🧑‍💻 Semi-interactive login
- 🤖 Noninteractive login using environment variables

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
<small><i>This will fetch the entire JSON object in the `database` secret and pass it through as a JSON string.</i></small>

**Example: Specific key in JSON object:**
```
awssm://us-east-1/prod/database::password
```
<small><i>This will fetch the `password` key from the JSON object in the `database` secret.</i></small>

<hr>

</details>

<details>
<summary><b>Google Cloud Secret Manager <code>(gcsm://)</code></b></summary>

<hr>

Fetches secrets from Google Cloud Secret Manager. Requires Google Cloud credentials to be configured. Uses the Google Cloud SDK to fetch secrets.

- ✅ Tested against a real Google Cloud project in CI
- 🧑‍💻 Semi-interactive login
- 🤖 Noninteractive login using environment variables

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
<small><i>This will fetch the entire JSON object in the `database` secret and pass it through as a JSON string.</i></small>

**Example: Specific key in JSON object:**
```
gcsm://projects/my-project/secrets/database/versions/latest::password
```
<small><i>This will fetch the `password` key from the JSON object in the `database` secret.</i></small>

<hr>
</details>

<details>
<summary><b>LastPass <code>(lp://)</code></b></summary>

<hr>

Uses the LastPass CLI to fetch secrets. Requires the `lpass` CLI to be installed.

❌ Needs testing

**Format:**
```
lp://group/item-name[/field]
```

**Example:**
```
lp://Personal/AWS/api-key
```

<hr>
</details>

<details>
<summary><b>Azure Key Vault <code>(azurekv://)</code></b></summary>

<hr>

Fetches secrets from Azure Key Vault. Requires Azure credentials to be configured. Uses the Azure SDK to fetch secrets.

❌ Needs testing

**Format:**
```
azurekv://vault-name.vault.azure.net/secret-name
```

**Example:**
```
azurekv://my-vault.vault.azure.net/database-password
```

<hr>
</details>

<details>
<summary><b>HashiCorp Vault <code>(hcv://)</code></b></summary>

<hr>

Fetches secrets from HashiCorp Vault. Requires the `VAULT_ADDR` and `VAULT_TOKEN` environment variables to be set. Uses the HashiCorp Vault SDK to fetch secrets.

❌ Needs testing

**Format:**
```
hcv://vault-address/secret/path
```

**Example:**
```
hcv://vault.example.com:8200/secret/data/database/credentials
```

<hr>

</details>

<details>
<summary><b>Doppler <code>(doppler://)</code></b></summary>

<hr>

Uses the Doppler CLI to fetch secrets. Requires the Doppler CLI to be installed.

❌ Needs testing

**Format:**
```
doppler://project/config/secret-name
```

**Example:**
```
doppler://my-project/dev/DATABASE_URL
```

<hr>
</details>

<details>
<summary><b>Infisical <code>(inf://)</code></b></summary>

<hr>

Uses the Infisical CLI to fetch secrets. Requires the Infisical CLI to be installed.

❌ Needs testing

**Format:**
```
inf://workspace/environment/secret-name
```

**Example:**
```
inf://my-project/dev/DATABASE_URL
```

<hr>
</details>


## Recommendations

- ✅ DO commit `salakala.json` - it should only contain paths to secrets, not the secrets themselves
- ❌ DON'T commit generated `.env` files
- Add `.env*` to your `.gitignore`

## Contributing

Contributions are welcome! Feel free to submit issues and pull requests.

## License

MIT