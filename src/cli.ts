#!/usr/bin/env node

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { SecretsManager } from './lib/SecretsManager.js';
import { SyncManager } from './lib/SyncManager.js';
import { program } from '@commander-js/extra-typings';
import { escapeEnvValue } from './lib/envEscape.js';
import { select, checkbox, input, confirm } from '@inquirer/prompts';
import { parseEnvContent, truncateValueForDisplay, generateConfig } from './lib/ImportUtils.js';

/**
 * Resolves the input file path with smart fallback logic.
 * If the exact file exists, uses it.
 * If not found and input doesn't contain extension, tries salakala.{input}.json.
 * 
 * @param {string} input - The input file path or name
 * @returns {string} The resolved file path
 * @throws {Error} If no valid file is found
 */
function resolveInputFile(input: string): string {
    // If the exact file exists, use it
    if (existsSync(input)) {
        return input;
    }

    // If the input doesn't contain a dot (no extension), try the salakala.{input}.json pattern
    if (!input.includes('.')) {
        const salakalatPattern = `salakala.${input}.json`;
        if (existsSync(salakalatPattern)) {
            return salakalatPattern;
        }
        
        // Both attempts failed
        throw new Error(`Configuration file not found. Tried:\n  - ${input}\n  - ${salakalatPattern}`);
    }

    // Input has extension but file doesn't exist
    throw new Error(`Configuration file '${input}' not found`);
}

/**
 * Detects available environments from a config file.
 * Returns null for flat configs, or array of environment names for nested configs.
 * 
 * @param {string} configPath - Path to the configuration file
 * @returns {string[] | null} Array of environment names or null if flat config
 */
function detectEnvironments(configPath: string): string[] | null {
    try {
        const configContent = readFileSync(configPath, 'utf-8');
        const config = JSON.parse(configContent);
        
        // Check if this has nested environments (values are objects)
        const environmentKeys = Object.keys(config).filter(key => 
            typeof config[key] === 'object' && config[key] !== null && !Array.isArray(config[key])
        );
        
        if (environmentKeys.length === 0) { 
            return null; // Flat config, no environments
        }
        
        // Return environment names
        return environmentKeys;
    } catch (error) {
        return null; // If we can't parse it, assume flat config
    }
}

/**
 * Prompts user to select an environment interactively.
 * 
 * @param {string[]} environments - Available environments
 * @returns {Promise<string>} Selected environment
 */
async function promptForEnvironment(environments: string[]): Promise<string> {
    return await select({
        message: 'Select an environment:',
        choices: environments.map(env => ({ value: env }))
    });
}

const PACKAGE_VERSION = '1.3.3';

program
    .name('salakala')
    .description('Generate .env files from various secret providers')
    .version(PACKAGE_VERSION);

program
    .option('-i, --input <file>', 'input config file path or environment name (e.g., "local" → "salakala.local.json")', 'salakala.json')
    .option('-e, --env <environment>', 'environment to use from input file (interactive selection if not provided)')
    .option('-o, --output <file>', 'output file path', '.env')
    .option('-w, --overwrite', 'overwrite the output file instead of merging with existing values')
    .option('-s, --set', 'set environment variables in the current shell instead of writing to a file')
    .action(async (options) => {
        try {
            const width = process.stdout.columns;
            const padding = Math.floor((width - options.output.length) / 2);

            const manager = new SecretsManager();
            const resolvedInputFile = resolveInputFile(options.input);
            
            // Determine environment to use
            let environment = options.env;
            
            // If no environment specified, check if config has environments
            if (!environment) {
                const availableEnvironments = detectEnvironments(resolvedInputFile);
                
                if (availableEnvironments && availableEnvironments.length > 0) {
                    // Interactive environment selection
                    environment = await promptForEnvironment(availableEnvironments);
                } else {
                    // Flat config, use default
                    environment = 'development';
                }
            }

            if(!options.set) {
                console.log(`${'-'.repeat(padding)}`);
                console.log(`🐟 Generating ${options.output} file for environment: '${environment}'`);
                console.log(`${'-'.repeat(padding)}`);
            }
            
            const secrets = await manager.loadSecrets(resolvedInputFile, environment);

            if(options.set) {
                Object.entries(secrets).forEach(([key, value]) => {
                    process.env[key] = value;
                });
                console.log(`${'-'.repeat(padding)}`);
                console.log(`🐟 Environment variables from salakala.json have been set the current shell`);
                console.log(`${'-'.repeat(padding)}`);
                return;
            } else {
                // Read existing .env file if it exists and we're not overwriting
                let mergedEnv = secrets;
                if (!options.overwrite && existsSync(options.output)) {
                    const existingContent = readFileSync(options.output, 'utf-8');
                    const existingEnv: Record<string, string> = {};
                    existingContent.split('\n').forEach(line => {
                        const match = line.match(/^([^=]+)=(.*)$/);
                        if (match) {
                            existingEnv[match[1]] = match[2];
                        }
                    });
                    // Merge existing env with new secrets (new secrets take precedence)
                    mergedEnv = { ...existingEnv, ...secrets };
                }
                
                // Convert merged secrets to .env format with proper escaping
                const envContent = Object.entries(mergedEnv)
                    .map(([key, value]) => `${key}=${escapeEnvValue(value)}`)
                    .join('\n');
                
                writeFileSync(options.output, envContent + '\n');
                console.log(`${'-'.repeat(padding)}`);
                const mode = options.overwrite ? 'overwrote' : 'updated';
                console.log(`💾 Successfully ${mode} ${options.output} using '${environment}' environment 🔒🐟`);
                console.log(`${'-'.repeat(padding)}`);
            }
        } catch (error) {
            console.error('Error:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });

program
    .command('sync')
    .description('Synchronize secrets from source to destination provider(s)')
    .option('-i, --input <file>', 'input config file path', 'salakala.json')
    .option('-e, --env <environment>', 'environment to use from input file')
    .option('-s, --secret <name>', 'sync only this specific secret')
    .option('--dry-run', 'show what would be synced without actually syncing')
    .option('-y, --yes', 'skip all prompts and overwrite conflicts automatically')
    .action(async (options) => {
        try {
            const manager = new SecretsManager();
            const resolvedInputFile = resolveInputFile(options.input);
            
            const syncManager = new SyncManager(manager.getProviders());
            const syncConfig = syncManager.loadSyncConfig(resolvedInputFile, options.env);

            if (!syncConfig) {
                console.error('Error: No sync configuration found in the config file.');
                console.error('Sync configurations must have both "src" and "dst" keys.');
                console.error('\nExample:');
                console.error(JSON.stringify({
                    "production": {
                        "src": {
                            "API_KEY": "op://vault/item/field"
                        },
                        "dst": {
                            "API_KEY": ["gcsm://projects/my-project/secrets/api-key/versions/latest"]
                        }
                    }
                }, null, 2));
                process.exit(1);
            }

            console.log('🔄 Starting sync operation...');
            if (options.dryRun) {
                console.log('🔍 DRY RUN MODE - No changes will be made');
            }
            if (options.secret) {
                console.log(`📌 Syncing only: ${options.secret}`);
            }
            console.log('');

            const results = await syncManager.sync(
                syncConfig,
                options.secret,
                options.dryRun,
                options.yes
            );

            syncManager.printSummary(results);

            const hasFailures = results.some(r => !r.success);
            if (hasFailures) {
                process.exit(1);
            }
        } catch (error) {
            console.error('Error:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });

program
    .command('import')
    .description('Import environment variables from .env file to secret provider')
    .option('-i, --input <file>', 'input .env file path')
    .action(async (options) => {
        try {
            const manager = new SecretsManager();
            
            // Step 1: Determine input source and parse
            let envVars: Record<string, string>;
            
            if (options.input) {
                // File path was explicitly provided
                if (existsSync(options.input)) {
                    const content = readFileSync(options.input, 'utf-8');
                    envVars = parseEnvContent(content);
                } else {
                    console.log(`File '${options.input}' not found.`);
                    const pastedContent = await input({
                        message: 'Paste your environment variables (press Ctrl+D when done):',
                    });
                    envVars = parseEnvContent(pastedContent);
                }
            } else {
                // No input specified, ask user
                const inputMethod = await select({
                    message: 'How would you like to provide environment variables?',
                    choices: [
                        { name: 'Read from .env file', value: 'file' },
                        { name: 'Paste variables', value: 'paste' }
                    ]
                });

                if (inputMethod === 'file') {
                    if (existsSync('.env')) {
                        const content = readFileSync('.env', 'utf-8');
                        envVars = parseEnvContent(content);
                    } else {
                        console.log('File .env not found.');
                        const pastedContent = await input({
                            message: 'Paste your environment variables (press Ctrl+D when done):',
                        });
                        envVars = parseEnvContent(pastedContent);
                    }
                } else {
                    const pastedContent = await input({
                        message: 'Paste your environment variables (press Ctrl+D when done):',
                    });
                    envVars = parseEnvContent(pastedContent);
                }
            }

            if (Object.keys(envVars).length === 0) {
                console.log('No environment variables found.');
                return;
            }

            // Step 2: Multi-select variables to import
            const selectedVars = await checkbox({
                message: 'Select environment variables to import:',
                choices: Object.entries(envVars).map(([key, value]) => ({
                    name: `${key} = ${truncateValueForDisplay(value)}`,
                    value: key
                }))
            });

            if (selectedVars.length === 0) {
                console.log('No variables selected.');
                return;
            }

            // Step 3: Select provider
            const providerEntries = Array.from(manager.getProviders().entries());
            const providerPrefix = await select({
                message: 'Select secret provider:',
                choices: providerEntries.map(([prefix, provider]) => {
                    const names: Record<string, string> = {
                        'op://': '1Password',
                        'bw://': 'Bitwarden',
                        'awssm://': 'AWS Secrets Manager',
                        'gcsm://': 'Google Cloud Secret Manager',
                        'azurekv://': 'Azure Key Vault',
                        'kp://': 'KeePass',
                        'lp://': 'LastPass'
                    };
                    return {
                        name: `${names[prefix] || prefix} (${prefix})`,
                        value: prefix
                    };
                })
            });

            const provider = manager.getProviders().get(providerPrefix)!;

            // Show provider capability
            if (provider.supportsMultipleFields) {
                console.log('\nℹ️  This provider supports multiple fields per item.');
            } else {
                console.log('\n⚠️  This provider stores one value per secret.');
            }

            // Step 4: Collect path components
            const components: Record<string, string> = {};
            for (const component of provider.pathComponents) {
                const value = await input({
                    message: component.description + (component.required ? ' (required)' : ' (optional)'),
                    default: component.default,
                    validate: (val) => {
                        if (component.required && !val.trim()) {
                            return 'This field is required';
                        }
                        return true;
                    }
                });
                
                if (value.trim()) {
                    components[component.name] = value.trim();
                }
            }

            // Step 5: Determine storage mode
            let storeAsJson = false;
            let jsonFieldName = '';
            
            if (provider.supportsMultipleFields) {
                storeAsJson = await confirm({
                    message: 'Store all variables as JSON in a single field?',
                    default: false
                });

                if (storeAsJson) {
                    jsonFieldName = await input({
                        message: 'Field name for JSON data:',
                        default: 'config'
                    });
                }
            } else {
                storeAsJson = await confirm({
                    message: 'Store as a single JSON secret? (otherwise creates separate secrets per variable)',
                    default: false
                });
            }

            // Step 6: Get environment name
            const environment = await input({
                message: 'Environment name (leave empty for flat config):',
                default: ''
            });

            // Step 7: Preview and confirm
            console.log('\n📋 Preview of items to create:');
            console.log(`  Provider: ${providerPrefix.slice(0, -3)} (${providerPrefix})`);
            console.log(`  Variables: ${selectedVars.length}`);
            if (storeAsJson) {
                console.log(`  Storage: JSON bundle in field "${jsonFieldName}"`);
                console.log(`  Item: ${components.item || components.entry || 'N/A'}`);
            } else if (provider.supportsMultipleFields) {
                console.log(`  Storage: ${selectedVars.length} separate fields`);
                console.log(`  Item: ${components.item || components.entry}`);
            } else {
                console.log(`  Storage: ${selectedVars.length} separate secrets`);
            }
            console.log(`  Selected variables: ${selectedVars.join(', ')}`);

            const confirmCreate = await confirm({
                message: '\nProceed with creating these items?',
                default: true
            });

            if (!confirmCreate) {
                console.log('Import cancelled.');
                return;
            }

            // Step 8: Write secrets to provider
            console.log('\n📝 Writing secrets to provider...');
            const providerPaths: Record<string, string> = {};
            const createdPaths: string[] = [];

            try {
                if (storeAsJson) {
                    // Store as JSON
                    const jsonValue = JSON.stringify(
                        Object.fromEntries(selectedVars.map(key => [key, envVars[key]]))
                    );
                    
                    const path = provider.buildPath(components, { 
                        fieldName: jsonFieldName
                    });
                    
                    await provider.setSecret(path, jsonValue);
                    createdPaths.push(path);
                    console.log(`✅ Stored ${selectedVars.length} variables as JSON at ${path}`);
                    
                    // Generate paths with JSON field access
                    for (const varName of selectedVars) {
                        providerPaths[varName] = `${path}::${varName}`;
                    }
                } else if (provider.supportsMultipleFields) {
                    // Store as separate fields in one item
                    for (const varName of selectedVars) {
                        const path = provider.buildPath(components, { fieldName: varName });
                        await provider.setSecret(path, envVars[varName]);
                        createdPaths.push(path);
                        providerPaths[varName] = path;
                    }
                    console.log(`✅ Stored ${selectedVars.length} fields in item '${components.item || components.entry}'`);
                } else {
                    // Store as separate secrets (single-field provider)
                    for (const varName of selectedVars) {
                        const secretComponents = { ...components, secret: varName };
                        const path = provider.buildPath(secretComponents);
                        await provider.setSecret(path, envVars[varName]);
                        createdPaths.push(path);
                        providerPaths[varName] = path;
                    }
                    console.log(`✅ Created ${selectedVars.length} separate secrets`);
                }

                // Verify with user
                const looksGood = await confirm({
                    message: '\nDoes everything look OK?',
                    default: true
                });

                if (!looksGood) {
                    const cleanup = await confirm({
                        message: 'Delete the items that were just created?',
                        default: true
                    });

                    if (cleanup) {
                        console.log('\n🗑️  Cleaning up created items...');
                        for (const path of createdPaths) {
                            try {
                                await provider.deleteSecret(path);
                                console.log(`  Deleted: ${path}`);
                            } catch (error) {
                                console.error(`  Failed to delete ${path}:`, error instanceof Error ? error.message : String(error));
                            }
                        }
                        console.log('Cleanup complete.');
                    }
                    console.log('Import cancelled.');
                    return;
                }

            } catch (error) {
                console.error('\n❌ Error writing secrets:', error instanceof Error ? error.message : String(error));
                process.exit(1);
            }

            // Step 9: Generate configuration
            const config = generateConfig({
                selectedVars,
                envVars,
                providerPaths,
                environment: environment || undefined
            });

            console.log('\n📄 Generated configuration:');
            console.log(JSON.stringify(config, null, 2));

            // Step 10: Save configuration
            const shouldSave = await confirm({
                message: '\nSave configuration to file?',
                default: true
            });

            if (shouldSave) {
                let filename = await input({
                    message: 'Configuration filename:',
                    default: 'salakala.json'
                });

                while (existsSync(filename)) {
                    const overwrite = await confirm({
                        message: `File '${filename}' already exists. Overwrite?`,
                        default: false
                    });

                    if (overwrite) {
                        break;
                    }

                    filename = await input({
                        message: 'Configuration filename:',
                        default: 'salakala.json'
                    });
                }

                writeFileSync(filename, JSON.stringify(config, null, 2) + '\n');
                console.log(`✅ Configuration saved to ${filename}`);
            }

        } catch (error) {
            console.error('Error:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });

program.parse(); 