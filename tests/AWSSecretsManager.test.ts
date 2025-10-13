import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AWSSecretsManagerProvider } from '../src/lib/providers/AWSSecretsManager.js';
import { parseEnvContent } from '../src/lib/ImportUtils.js';
import { testEnvContent, expectedParsedValues, simpleTestVars, jsonTestVars, keyValueJsonData, nestedJsonData } from './fixtures/import-test-data.js';
import { generateTestId } from './test-utils.js';

describe('AWSSecretsManagerProvider', () => {
    let provider: AWSSecretsManagerProvider;
    let region: string;
    const createdSecrets: string[] = [];

    beforeEach(() => {
        region = process.env.AWS_REGION || 'us-east-1';
        provider = new AWSSecretsManagerProvider();
    });

    afterEach(async () => {
        for (const secretPath of createdSecrets) {
            try {
                await provider.deleteSecret(secretPath);
            } catch (error) {
                console.error('Error deleting AWS secret', error);
                // Ignore errors during cleanup
            }
        }
        createdSecrets.length = 0;
    });

    it('should throw error for invalid path format', async () => {
        await expect(provider.getSecret('invalid-path'))
            .rejects
            .toThrow('Invalid URI: invalid-path');
    });

    it('should retrieve entire secret as JSON when no key specified', async () => {
        const secretId = `test/${generateTestId('test-json-secret')}`;
        createdSecrets.push(`awssm://${region}/${secretId}`);
        
        const path = `awssm://${region}/${secretId}`;
        await provider.setSecret(path, JSON.stringify(keyValueJsonData));
        
        const secret = await provider.getSecret(path);
        expect(typeof secret).toBe('string');
        expect(() => JSON.parse(secret)).not.toThrow();
        const parsed = JSON.parse(secret);
        expect(parsed).toBeTypeOf('object');
        expect(parsed['secret-key']).toBe(keyValueJsonData['secret-key']);
    }, 15000);

    it('should retrieve specific key from secret', async () => {
        const secretId = `test/${generateTestId('test-key-secret')}`;
        createdSecrets.push(`awssm://${region}/${secretId}`);
        
        const path = `awssm://${region}/${secretId}`;
        await provider.setSecret(path, JSON.stringify(keyValueJsonData));
        
        const secret = await provider.getSecret(`${path}::secret-key`);
        expect(typeof secret).toBe('string');
        expect(secret.length).toBeGreaterThan(0);
        expect(secret).toBe(keyValueJsonData['secret-key']);
    }, 15000);

    it('should throw on invalid path', async () => {
        await expect(provider.getSecret(`awssm://${region}/non-existent-secret-${Date.now()}`))
            .rejects
            .toThrow(/Failed to read AWS Secrets Manager secret/);
    });

    it('should throw on invalid key in key-value secret', async () => {
        const secretId = `test/${generateTestId('test-invalid-key')}`;
        createdSecrets.push(`awssm://${region}/${secretId}`);
        
        const path = `awssm://${region}/${secretId}`;
        await provider.setSecret(path, JSON.stringify(keyValueJsonData));
        
        await expect(provider.getSecret(`${path}::non-existent-key`))
            .rejects
            .toThrow(/Key non-existent-key not found in JSON object/);
    }, 15000);


    describe('Write operations', () => {
        it('should update an existing secret', async () => {
            const secretId = `test/${generateTestId('test-update-secret')}`;
            const initialValue = `initial-${Date.now()}`;
            const updatedValue = `updated-${Date.now()}`;
            createdSecrets.push(`awssm://${region}/${secretId}`);
            console.log(`Created secret: awssm://${region}/${secretId}`);
            await provider.setSecret(`awssm://${region}/${secretId}`, initialValue);
            const firstRead = await provider.getSecret(`awssm://${region}/${secretId}`);
            expect(firstRead).toBe(initialValue);
            
            await provider.setSecret(`awssm://${region}/${secretId}`, updatedValue);
            const secondRead = await provider.getSecret(`awssm://${region}/${secretId}`);
            expect(secondRead).toBe(updatedValue);
        }, 15000);

        it('should throw error for invalid write path format', async () => {
            await expect(provider.setSecret('invalid-path', 'value'))
                .rejects
                .toThrow('Invalid URI: invalid-path');
        });

        it('should delete a secret', async () => {
            const secretId = `test/${generateTestId('test-delete-secret')}`;
            const testValue = 'value-to-delete';
                        
            await provider.setSecret(`awssm://${region}/${secretId}`, testValue);
            await provider.deleteSecret(`awssm://${region}/${secretId}`);
            
            await expect(provider.getSecret(`awssm://${region}/${secretId}`))
                .rejects
                .toThrow();
        }, 15000);
    });

    describe('buildPath', () => {
        it('should build correct path with region and secret', () => {
            const path = provider.buildPath({
                region: 'us-east-1',
                secret: 'my-secret'
            });
            expect(path).toBe('awssm://us-east-1/my-secret');
        });

        it('should build path regardless of fieldName option', () => {
            const path = provider.buildPath(
                { region: 'eu-west-1', secret: 'test-secret' },
                { fieldName: 'ignored' }
            );
            expect(path).toBe('awssm://eu-west-1/test-secret');
        });
    });

    describe('Import integration: JSON bundle storage', () => {
        it('should store and retrieve env vars as JSON bundle', async () => {
            const secretId = generateTestId('test-import-json');
            createdSecrets.push(secretId);
            
            // Parse test env content
            const envVars = parseEnvContent(testEnvContent);
            
            // Create JSON bundle
            const jsonBundle = JSON.stringify(envVars);
            const bundlePath = provider.buildPath({
                region,
                secret: secretId
            });
            
            // Store bundle
            await provider.setSecret(bundlePath, jsonBundle);
            
            // Retrieve and verify
            const retrieved = await provider.getSecret(bundlePath);
            const parsed = JSON.parse(retrieved);
            
            expect(parsed.SIMPLE_VALUE).toBe(expectedParsedValues.SIMPLE_VALUE);
            expect(parsed.DATABASE_URL).toBe(expectedParsedValues.DATABASE_URL);
            expect(parsed.ENCODED_VALUE).toBe(expectedParsedValues.ENCODED_VALUE);
            
            // Verify nested JSON survived the round-trip
            const jsonConfig = JSON.parse(parsed.JSON_CONFIG);
            expect(jsonConfig.database.host).toBe('localhost');
            expect(jsonConfig.api.endpoint).toBe('https://api.example.com/v1');
        }, 20000);

        it('should retrieve specific fields from JSON bundle using :: syntax', async () => {
            const secretId = generateTestId('test-import-json-field');
            createdSecrets.push(secretId);
            
            const envVars = parseEnvContent(testEnvContent);
            const jsonBundle = JSON.stringify(envVars);
            const bundlePath = provider.buildPath({
                region,
                secret: secretId
            });
            
            await provider.setSecret(bundlePath, jsonBundle);
            
            // Retrieve specific fields using :: syntax
            const simpleValue = await provider.getSecret(`${bundlePath}::SIMPLE_VALUE`);
            const dbUrl = await provider.getSecret(`${bundlePath}::DATABASE_URL`);
            const jsonConfig = await provider.getSecret(`${bundlePath}::JSON_CONFIG`);
            
            expect(simpleValue).toBe(expectedParsedValues.SIMPLE_VALUE);
            expect(dbUrl).toBe(expectedParsedValues.DATABASE_URL);
            
            // Verify nested JSON is still valid
            const parsed = JSON.parse(jsonConfig);
            expect(parsed.database.host).toBe('localhost');
        }, 20000);

        it('should handle JSON inside JSON bundle', async () => {
            const secretId = generateTestId('test-import-nested-json');
            createdSecrets.push(secretId);
            
            const jsonBundle = JSON.stringify(nestedJsonData);
            const bundlePath = provider.buildPath({
                region,
                secret: secretId
            });
            
            await provider.setSecret(bundlePath, jsonBundle);
            
            // Retrieve the outer JSON field
            const outerJson = await provider.getSecret(`${bundlePath}::OUTER_JSON`);
            expect(typeof outerJson).toBe('string');
            
            // Parse and verify the inner structure
            const parsed = JSON.parse(outerJson);
            expect(parsed.inner.nested).toBe('value');
            expect(parsed.array).toEqual([1, 2, 3]);
        }, 20000);
    });

    describe('Import integration: Individual secrets storage', () => {
        it('should store and retrieve multiple separate secrets', async () => {
            const baseId = generateTestId('test-import');
            const secretIds: string[] = [];
            
            const testVars = simpleTestVars;
            
            // Store each var as a separate secret
            for (const [key, value] of Object.entries(testVars)) {
                const secretId = `${baseId}-${key.toLowerCase()}`;
                secretIds.push(secretId);
                createdSecrets.push(secretId);
                
                const path = provider.buildPath({
                    region,
                    secret: secretId
                });
                await provider.setSecret(path, value);
            }
            
            // Retrieve and verify each secret
            let index = 0;
            for (const [key, expectedValue] of Object.entries(testVars)) {
                const path = provider.buildPath({
                    region,
                    secret: secretIds[index]
                });
                const retrieved = await provider.getSecret(path);
                expect(retrieved).toBe(expectedValue);
                index++;
            }
        }, 20000);

        it('should store JSON values as individual secrets', async () => {
            const baseId = generateTestId('test-import-json');
            const secretIds: string[] = [];
            
            const testVars = jsonTestVars;
            
            // Store JSON values as separate secrets
            for (const [key, value] of Object.entries(testVars)) {
                const secretId = `${baseId}-${key.toLowerCase()}`;
                secretIds.push(secretId);
                createdSecrets.push(secretId);
                
                const path = provider.buildPath({
                    region,
                    secret: secretId
                });
                await provider.setSecret(path, value);
            }
            
            // Retrieve and verify JSON is still valid
            let index = 0;
            for (const [key, expectedValue] of Object.entries(testVars)) {
                const path = provider.buildPath({
                    region,
                    secret: secretIds[index]
                });
                const retrieved = await provider.getSecret(path);
                expect(retrieved).toBe(expectedValue);
                
                // Verify it parses correctly
                const parsed = JSON.parse(retrieved);
                expect(parsed).toBeDefined();
                index++;
            }
        }, 20000);
    });
});
