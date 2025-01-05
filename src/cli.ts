#!/usr/bin/env node

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { SecretsManager } from './lib/SecretProvider.js';
import { program } from '@commander-js/extra-typings';
import { escapeEnvValue } from './lib/envEscape.js';

const packageJson = JSON.parse(readFileSync(import.meta.dirname + '/../package.json', 'utf-8'));
const version = packageJson.version;

program
    .name('salakala')
    .description('Generate .env files from various secret providers')
    .version(version);

program
    .option('-e, --env <environment>', 'environment to use from salakala.json', 'development')
    .option('-o, --output <file>', 'output file path', '.env')
    .action(async (options) => {
        try {
            const width = process.stdout.columns;
            const padding = Math.floor((width - options.output.length) / 2);

            console.log(`${'-'.repeat(padding)}`);
            console.log(`Generating ${options.output} file for '${options.env}' environment 🔒🐟`);
            console.log(`${'-'.repeat(padding)}`);
            
            const manager = new SecretsManager();
            const secrets = await manager.loadSecrets('salakala.json', options.env);

            // Read existing .env file if it exists
            let existingEnv: Record<string, string> = {};
            if (existsSync(options.output)) {
                const existingContent = readFileSync(options.output, 'utf-8');
                existingContent.split('\n').forEach(line => {
                    const match = line.match(/^([^=]+)=(.*)$/);
                    if (match) {
                        existingEnv[match[1]] = match[2];
                    }
                });
            }

            // Merge existing env with new secrets (new secrets take precedence)
            const mergedEnv = { ...existingEnv, ...secrets };
            
            // Convert merged secrets to .env format with proper escaping
            const envContent = Object.entries(mergedEnv)
                .map(([key, value]) => `${key}=${escapeEnvValue(value)}`)
                .join('\n');
            
            writeFileSync(options.output, envContent + '\n');
            console.log(`${'-'.repeat(padding)}`);
            console.log(`Successfully updated ${options.output} using '${options.env}' environment 🔒🐟`);
            console.log(`${'-'.repeat(padding)}`);
        } catch (error) {
            console.error('Error:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });

program.parse(); 