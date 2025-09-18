#!/usr/bin/env node

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { SecretsManager } from './lib/SecretsManager.js';
import { program } from '@commander-js/extra-typings';
import { escapeEnvValue } from './lib/envEscape.js';

const PACKAGE_VERSION = '1.0.1';

program
    .name('salakala')
    .description('Generate .env files from various secret providers')
    .version(PACKAGE_VERSION);

program
    .option('-i, --input <file>', 'input salakala json file path', 'salakala.json')
    .option('-e, --env <environment>', 'environment to use from input file', 'development')
    .option('-o, --output <file>', 'output file path', '.env')
    .option('-w, --overwrite', 'overwrite the output file instead of merging with existing values')
    .option('-s, --set', 'set environment variables in the current shell instead of writing to a file')
    .action(async (options) => {
        try {
            const width = process.stdout.columns;
            const padding = Math.floor((width - options.output.length) / 2);

            if(!options.set) {
                console.log(`${'-'.repeat(padding)}`);
                console.log(`🐟 Generating ${options.output} file for environment: '${options.env}'`);
                console.log(`${'-'.repeat(padding)}`);
            }
            
            const manager = new SecretsManager();
            const secrets = await manager.loadSecrets(options.input, options.env);

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
                console.log(`💾 Successfully ${mode} ${options.output} using '${options.env}' environment 🔒🐟`);
                console.log(`${'-'.repeat(padding)}`);
            }
        } catch (error) {
            console.error('Error:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });

program.parse(); 