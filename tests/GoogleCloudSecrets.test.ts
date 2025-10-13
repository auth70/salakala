import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GoogleCloudSecretsProvider } from '../src/lib/providers/GoogleCloudSecrets.js';
import { parseEnvContent } from '../src/lib/ImportUtils.js';
import { testEnvContent, expectedParsedValues, simpleTestVars, jsonTestVars, keyValueJsonData, nestedJsonData } from './fixtures/import-test-data.js';

describe('GoogleCloudSecretsProvider', () => {
    let provider: GoogleCloudSecretsProvider;
    let projectId: string;
    const createdSecrets: string[] = [];

    beforeEach(() => {
        const envProjectId = process.env.GOOGLE_CLOUD_PROJECT;
        if (!envProjectId) {
            throw new Error('GOOGLE_CLOUD_PROJECT environment variable must be set');
        }
        projectId = envProjectId;
        provider = new GoogleCloudSecretsProvider();
    });

    afterEach(async () => {
        for (const secretId of createdSecrets) {
            try {
                await provider.deleteSecret(`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`);
            } catch (error) {
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
        const timestamp = Date.now();
        const secretId = `test-json-secret-${timestamp}`;
        createdSecrets.push(secretId);
        
        const path = `gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`;
        await provider.setSecret(path, JSON.stringify(keyValueJsonData));
        
        const secret = await provider.getSecret(path);
        expect(typeof secret).toBe('string');
        expect(() => JSON.parse(secret)).not.toThrow();
        const parsed = JSON.parse(secret);
        expect(parsed).toBeTypeOf('object');
        expect(parsed['secret-key']).toBe(keyValueJsonData['secret-key']);
    }, 15000);

    it('should retrieve plaintext secret when no key specified', async () => {
        const timestamp = Date.now();
        const secretId = `test-plain-secret-${timestamp}`;
        createdSecrets.push(secretId);
        
        const path = `gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`;
        await provider.setSecret(path, '12345');
        
        const secret = await provider.getSecret(path);
        expect(typeof secret).toBe('string');
        expect(secret).toBe('12345');
    }, 15000);

    it('should retrieve specific key from secret', async () => {
        const timestamp = Date.now();
        const secretId = `test-key-access-${timestamp}`;
        createdSecrets.push(secretId);
        
        const path = `gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`;
        await provider.setSecret(path, JSON.stringify(keyValueJsonData));
        
        const secret = await provider.getSecret(`${path}::secret-key`);
        expect(typeof secret).toBe('string');
        expect(secret.length).toBeGreaterThan(0);
        expect(secret).toBe(keyValueJsonData['secret-key']);
    }, 15000);

    it('should throw on invalid path', async () => {
        await expect(provider.getSecret(`gcsm://projects/${projectId}/secrets/non-existent-secret-${Date.now()}/versions/latest`))
            .rejects
            .toThrow(/Failed to read Google Cloud secret/);
    });

    it('should throw on invalid key in key-value secret', async () => {
        const timestamp = Date.now();
        const secretId = `test-invalid-key-${timestamp}`;
        createdSecrets.push(secretId);
        
        const path = `gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`;
        await provider.setSecret(path, JSON.stringify(keyValueJsonData));
        
        await expect(provider.getSecret(`${path}::non-existent-key`))
            .rejects
            .toThrow(/Key non-existent-key not found in JSON object/);
    }, 15000);

    it('should return original value when accessing non-JSON secret with key', async () => {
        const timestamp = Date.now();
        const secretId = `test-nonjson-key-${timestamp}`;
        createdSecrets.push(secretId);
        
        const path = `gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`;
        await provider.setSecret(path, 'plain-text-value');
        
        // When JSON parsing fails, returnPossibleJsonValue returns the original value
        const result = await provider.getSecret(`${path}::some-key`);
        expect(result).toBe('plain-text-value');
    }, 15000);

    describe('Write operations', () => {
        it('should write a new secret to Google Cloud', async () => {
            const secretId = `test-write-secret-${Date.now()}`;
            const testValue = `test-value-${Date.now()}`;
            createdSecrets.push(secretId);
            
            await provider.setSecret(`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`, testValue);
            
            const retrievedValue = await provider.getSecret(`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`);
            expect(retrievedValue).toBe(testValue);
        }, 15000);

        it('should add a new version to existing secret', async () => {
            const secretId = `test-update-secret-${Date.now()}`;
            const initialValue = `initial-${Date.now()}`;
            const updatedValue = `updated-${Date.now()}`;
            createdSecrets.push(secretId);
            
            await provider.setSecret(`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`, initialValue);
            const firstRead = await provider.getSecret(`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`);
            expect(firstRead).toBe(initialValue);
            
            await provider.setSecret(`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`, updatedValue);
            
            // Wait for eventual consistency with exponential backoff
            let secondRead = await provider.getSecret(`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`);
            let retries = 0;
            let waitTime = 5000; // Start with 5 seconds
            const maxWaitTime = 60000; // Max 1 minute
            
            while (secondRead !== updatedValue && retries < 10) {
                await new Promise(resolve => setTimeout(resolve, waitTime));
                secondRead = await provider.getSecret(`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`);
                retries++;
                waitTime = Math.min(waitTime * 2, maxWaitTime); // Exponential backoff capped at 1 minute
            }
            
            expect(secondRead).toBe(updatedValue);
        }, 120000);

        it('should throw error for invalid write path format', async () => {
            await expect(provider.setSecret('invalid-path', 'value'))
                .rejects
                .toThrow('Invalid URI: invalid-path');
        });

        it('should handle JSON content in secret', async () => {
            const secretId = `test-json-write-${Date.now()}`;
            const jsonValue = JSON.stringify({ key: 'value', nested: { data: 'test' } });
            createdSecrets.push(secretId);
            
            await provider.setSecret(`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`, jsonValue);
            
            const retrievedValue = await provider.getSecret(`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`);
            expect(retrievedValue).toBe(jsonValue);
            
            const parsedValue = JSON.parse(retrievedValue);
            expect(parsedValue.key).toBe('value');
            expect(parsedValue.nested.data).toBe('test');
        }, 15000);

        it('should delete a secret', async () => {
            const secretId = `test-delete-secret-${Date.now()}`;
            const testValue = 'value-to-delete';
            
            await provider.setSecret(`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`, testValue);
            await provider.deleteSecret(`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`);
            
            await expect(provider.getSecret(`gcsm://projects/${projectId}/secrets/${secretId}/versions/latest`))
                .rejects
                .toThrow();
        }, 15000);
    });

    describe('buildPath', () => {
        it('should build correct path with project, secret, and version', () => {
            const path = provider.buildPath({
                project: 'my-project',
                secret: 'my-secret',
                version: 'latest'
            });
            expect(path).toBe('gcsm://projects/my-project/secrets/my-secret/versions/latest');
        });

        it('should use default version "latest" when not provided', () => {
            const path = provider.buildPath({
                project: 'test-project',
                secret: 'test-secret'
            });
            expect(path).toBe('gcsm://projects/test-project/secrets/test-secret/versions/latest');
        });

        it('should handle specific version numbers', () => {
            const path = provider.buildPath({
                project: 'my-project',
                secret: 'my-secret',
                version: '5'
            });
            expect(path).toBe('gcsm://projects/my-project/secrets/my-secret/versions/5');
        });
    });

    describe('Import integration: JSON bundle storage', () => {
        it('should store and retrieve env vars as JSON bundle', async () => {
            const timestamp = Date.now();
            const secretId = `test-import-json-${timestamp}`;
            createdSecrets.push(secretId);
            
            // Parse test env content
            const envVars = parseEnvContent(testEnvContent);
            
            // Create JSON bundle
            const jsonBundle = JSON.stringify(envVars);
            const bundlePath = provider.buildPath({
                project: projectId,
                secret: secretId,
                version: 'latest'
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
            const timestamp = Date.now();
            const secretId = `test-import-json-field-${timestamp}`;
            createdSecrets.push(secretId);
            
            const envVars = parseEnvContent(testEnvContent);
            const jsonBundle = JSON.stringify(envVars);
            const bundlePath = provider.buildPath({
                project: projectId,
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
            const timestamp = Date.now();
            const secretId = `test-import-nested-json-${timestamp}`;
            createdSecrets.push(secretId);
            
            const jsonBundle = JSON.stringify(nestedJsonData);
            const bundlePath = provider.buildPath({
                project: projectId,
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
            const timestamp = Date.now();
            const secretIds: string[] = [];
            
            const testVars = simpleTestVars;
            
            // Store each var as a separate secret
            for (const [key, value] of Object.entries(testVars)) {
                const secretId = `test-import-${key.toLowerCase()}-${timestamp}`;
                secretIds.push(secretId);
                createdSecrets.push(secretId);
                
                const path = provider.buildPath({
                    project: projectId,
                    secret: secretId
                });
                await provider.setSecret(path, value);
            }
            
            // Retrieve and verify each secret
            let index = 0;
            for (const [key, expectedValue] of Object.entries(testVars)) {
                const path = provider.buildPath({
                    project: projectId,
                    secret: secretIds[index]
                });
                const retrieved = await provider.getSecret(path);
                expect(retrieved).toBe(expectedValue);
                index++;
            }
        }, 20000);

        it('should store JSON values as individual secrets', async () => {
            const timestamp = Date.now();
            const secretIds: string[] = [];
            
            const testVars = jsonTestVars;
            
            // Store JSON values as separate secrets
            for (const [key, value] of Object.entries(testVars)) {
                const secretId = `test-import-json-${key.toLowerCase()}-${timestamp}`;
                secretIds.push(secretId);
                createdSecrets.push(secretId);
                
                const path = provider.buildPath({
                    project: projectId,
                    secret: secretId
                });
                await provider.setSecret(path, value);
            }
            
            // Retrieve and verify JSON is still valid
            let index = 0;
            for (const [key, expectedValue] of Object.entries(testVars)) {
                const path = provider.buildPath({
                    project: projectId,
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