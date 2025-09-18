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

1. Create a `salakala.json` file in your project (safe to commit to your repository!)
2. Run salakala to generate your `.env` file or set environment variables:

```bash
# Generate .env file in the current directory (default)
salakala

# Set environment variables in the current shell
salakala -s

# Specify an environment
salakala -e staging

# Specify a different input file
salakala -i some-config.json

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

## JSON Field Access

salakala supports accessing specific fields within JSON values using the `::jsonKey` syntax.

### Syntax

```text
provider://path/to/secret::jsonKey
```

The `::` separator tells salakala to:

1. Fetch the secret value
2. Parse it as JSON
3. Extract the specified key/path
4. Return that value as a string

### Supported Key Patterns

- **Simple key access**: `::username`
- **Nested object access**: `::database.host` or `::api.credentials.key`  
- **Array access**: `::servers[0]` or `::endpoints[1].url`
- **Empty array access**: `::items[]` (gets first item)

### Example

If your secret contains this JSON:

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

You can access specific fields:
```json
{
  "DB_HOST": "op://vault/config/database::database.host",
  "DB_USER": "op://vault/config/database::database.credentials.username",
  "DB_PASS": "op://vault/config/database::database.credentials.password",
  "WEB_SERVER": "op://vault/config/database::servers[0]"
}
```

## Providers

<details>
<summary><b>1Password <code>(op://)</code></b></summary>

<hr>

Requires the 1Password CLI (`op`) to be present.

- ✅ Tested in CI
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
<summary><b>Bitwarden Password Manager <code>(bw://)</code></b></summary>

<hr>

Requires the Bitwarden CLI (`bw`) to be present. Supports different vault locations.

- ✅ Tested in CI
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

Requires the KeePassXC CLI (`keepassxc-cli`) to be present.

- ✅ Tested in CI
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

Fetches secrets from AWS Secrets Manager. Requires some form of AWS credentials to be configured e.g. by installing the AWS CLI and running `aws configure`. Uses the AWS SDK to fetch secrets (the `aws` CLI is not required).

- ✅ Tested in CI

**Format:**
```
awssm://region/secret-name[::jsonKey]
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

Fetches secrets from Google Cloud Secret Manager. Requires Google Cloud credentials to be configured, e.g. by installing the Google Cloud CLI and running `gcloud auth login`. Uses the Google Cloud SDK to fetch secrets (the `gcloud` CLI is not required).

- ✅ Tested against a real Google Cloud project in CI

**Format:**
```
gcsm://projects/project-id/secrets/secret-id/versions/version[::jsonKey]
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

If you want to add a new provider, you can do so by extending the `SecretProvider` class and adding it to the `providers` map in `src/lib/SecretsManager.ts`. Please submit a PR and make tests for it!

## Recommendations

- ✅ DO commit `salakala.json` - it should only contain paths to secrets, not the secrets themselves
- ❌ DON'T commit generated `.env` files
- Add `.env*` to your `.gitignore`

## Thanks to

- [1Password](https://1password.com) for sponsoring a team license used for testing.

## Contributing

Contributions are welcome! Feel free to submit issues and pull requests.

## License

MIT
