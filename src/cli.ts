#!/usr/bin/env node

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { SecretsManager } from './lib/SecretsManager.js';
import { program } from '@commander-js/extra-typings';
import { escapeEnvValue } from './lib/envEscape.js';
import inquirer from 'inquirer';

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
    const { selectedEnvironment } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selectedEnvironment',
            message: 'Select an environment:',
            choices: environments,
            loop: false
        }
    ]);
    return selectedEnvironment;
}

const PACKAGE_VERSION = '1.1.0';

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

program.parse(); 