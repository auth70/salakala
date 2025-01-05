# salakala 🔒🐟

<p align="center">
  <a href="https://github.com/auth70/salakala/actions"><img src="https://img.shields.io/github/actions/workflow/status/auth70/salakala/ci.yml?logo=github" alt="build"></a>
  <a href="https://www.npmjs.com/package/salakala"><img src="https://img.shields.io/npm/v/salakala" alt="npm"></a>
  <a href="https://www.npmjs.com/package/salakala"><img src="https://img.shields.io/npm/types/salakala" alt="npm type definitions"></a>
</p>

We've all been there, sharing `.env` files in Slack to get a Javascript application quickly working on someone's local machine while feeling bad about security practices. 🫠

But teams always have a shared secret or password manager (1Password, Bitwarden, Google Secrets Manager, AWS Secrets Manager, etc)...

... and you're almost always logged in to it in some form (CLI, service account, etc), right?

What if you just had a nice little JSON file in your code repository that defined which environment variables to fetch from any manager?

```json
{
    "development": {
        "SECRET_ENV_VALUE": "op://application-secrets/test/test-section",
        "SECRET_ENV_VALUE_2": "lp://application-secrets/test/test-section",
        "SECRET_ENV_VALUE_3": "awssm://us-east-1/application-secrets/test/test-section"
    },
    "staging": {
        "SECRET_ENV_VALUE": "op://application-secrets/staging/test-section",
        "SECRET_ENV_VALUE_2": "lp://application-secrets/staging/test-section",
        "SECRET_ENV_VALUE_3": "awssm://us-east-1/application-secrets/staging/test-section"
    }
}
```

salakala does exactly that! It wraps around your secrets manager and generates `.env` files for your local development environment. As long as you're logged in to the manager you're using, it should just work.

## Installation

```bash
# Install globally to use the CLI
npm install -g salakala
```

## Usage

### CLI Usage

1. Create a `salakala.json` file in your project (this file is safe to commit to your repository)
2. Run salakala to generate your `.env` file:

```bash
# Generate .env for development (default)
salakala

# Or specify an environment
salakala --env staging

# Specify a different output file
salakala --output .env.local

# Show help
salakala --help
```

#### Example salakala.json

##### Flat structure (no environment specific secrets):

```json
{
    "SECRET_ENV_VALUE": "op://application-secrets/test/test-section",
    "SECRET_ENV_VALUE2": "op://application-secrets/test/test-section"
}
```

##### Nested structure (environment specific secrets):

```json
{
    "development": {
        "SECRET_ENV_VALUE": "op://application-secrets/test/test-section"
    },
    "staging": {
        "SECRET_ENV_VALUE": "op://application-secrets/staging/test-section"
    }
}
```

## Supported Providers

### 1Password (`op://`)
Uses the 1Password CLI to fetch secrets.
- Format: `op://vault-name/item-name/[section-name/]field-name`
- Example: `op://Personal/AWS/access-key`
- Requirements: 
  - 1Password CLI (`op`) installed
  - Logged in to 1Password CLI

### LastPass (`lp://`)
Uses the LastPass CLI to fetch secrets.
- Format: `lp://group/item-name[/field]`
- Example: `lp://Personal/AWS/api-key`
- Default field: `password`
- Supported fields: `password`, `username`, `url`, `notes`, or any custom field
- Requirements:
  - LastPass CLI (`lpass`) installed
  - Logged in to LastPass CLI

### Bitwarden (`bw://`)
Uses the Bitwarden CLI to fetch secrets.
- Format: `bw://item-id/field`
- Example: `bw://9c9448b3-3d30-4e01-8d3c-3a4b8d14d00a/password`
- Requirements:
  - Bitwarden CLI (`bw`) installed
  - Logged in to Bitwarden CLI

### AWS Secrets Manager (`awssm://`)
Fetches secrets from AWS Secrets Manager.
- Format: `awssm://region/secret-name`
- Example: `awssm://us-east-1/prod/database/credentials`
- Requirements:
  - AWS credentials configured
  - Appropriate IAM permissions

### Google Cloud Secret Manager (`gcsm://`)
Fetches secrets from Google Cloud Secret Manager.
- Format: `gcsm://projects/project-id/secrets/secret-id/versions/version`
- Example: `gcsm://projects/my-project/secrets/api-key/versions/latest`
- Requirements:
  - Google Cloud credentials configured
  - Appropriate IAM permissions

### Azure Key Vault (`azurekv://`)
Fetches secrets from Azure Key Vault.
- Format: `azurekv://vault-name.vault.azure.net/secret-name`
- Example: `azurekv://my-vault.vault.azure.net/database-password`
- Requirements:
  - Azure credentials configured (uses DefaultAzureCredential)
  - Appropriate access policies

### HashiCorp Vault (`hcv://`)
Fetches secrets from HashiCorp Vault.
- Format: `hcv://vault-address/secret/path`
- Example: `hcv://vault.example.com:8200/secret/data/database/credentials`
- Supports both KV v1 and v2 secret engines
- Requirements:
  - Vault server accessible
  - `VAULT_ADDR` and `VAULT_TOKEN` environment variables set

### Doppler (`doppler://`)
Uses the Doppler CLI to fetch secrets.
- Format: `doppler://project/config/secret-name`
- Example: `doppler://my-project/dev/DATABASE_URL`
- Requirements:
  - Doppler CLI installed
  - Logged in to Doppler CLI (`doppler login`)

### Infisical (`inf://`)
Uses the Infisical CLI to fetch secrets.
- Format: `inf://workspace/environment/secret-name`
- Example: `inf://my-project/dev/DATABASE_URL`
- Requirements:
  - Infisical CLI installed
  - Logged in to Infisical CLI (`infisical login`)

### KeePass/KeePassXC (`kp://`)
Uses the KeePassXC CLI to fetch secrets from a KeePass database.
- Format: `kp://path/to/database.kdbx/entry-path/field`
- Example: `kp:///Users/me/secrets.kdbx/Web/GitHub/password`
- Supported fields: `password`, `username`, `url`, `notes`, or any custom field
- Requirements:
  - KeePassXC CLI (`keepassxc-cli`) installed
  - Valid KeePass database file (.kdbx)
  - Database password will be prompted when accessing secrets

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

## Error Handling

The CLI will:
- Provide clear error messages if a provider isn't configured
- Automatically retry after login for CLI-based providers
- Show which secrets failed to load and why
- Exit with non-zero status if any secrets fail to load

## Contributing

Contributions are welcome! Feel free to submit issues and pull requests. 