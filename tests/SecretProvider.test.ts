import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecretsManager } from '../src/lib/SecretsManager.js';
import { escapeEnvValue } from '../src/lib/envEscape.js';
import { readFileSync } from 'fs';

// Mock fs.readFileSync
vi.mock('fs', () => ({
    readFileSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),  // Mock existsSync to avoid reading .env file
    writeFileSync: vi.fn()  // Mock writeFileSync to avoid writing files
}));

// Mock process.exit to prevent unhandled errors
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

// Mock console to prevent noise in test output
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'info').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('SecretsManager', () => {
    let manager: SecretsManager;

    beforeEach(() => {
        manager = new SecretsManager();
        // Reset process.env for each test
        process.env = {};
    });

    it('should load secrets from flat config', async () => {
        // Set up mock flat config
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
            "DB_PASSWORD": "op://vault/item/field",
            "API_KEY": "gcsm://projects/my-project/secrets/api-key/versions/1"
        }));

        // Mock the providers
        manager['providers'] = new Map([
            ['op://', { getSecret: async () => 'op-secret' }],
            ['gcsm://', { getSecret: async () => 'gcs-secret' }]
        ]);

        const secrets = await manager.loadSecrets('config.json');
        
        expect(secrets).toEqual({
            DB_PASSWORD: 'op-secret',
            API_KEY: 'gcs-secret'
        });
    });

    it('should load secrets from environment config', async () => {
        // Set up mock environment config
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
            development: {
                "DB_PASSWORD": "op://vault/item/field",
                "API_KEY": "gcsm://projects/my-project/secrets/api-key/versions/1"
            },
            staging: {
                "DB_PASSWORD": "op://vault/item/staging-field",
                "API_KEY": "gcsm://projects/my-project/secrets/api-key/versions/2"
            }
        }));

        // Mock the providers
        manager['providers'] = new Map([
            ['op://', { getSecret: async () => 'op-secret' }],
            ['gcsm://', { getSecret: async () => 'gcs-secret' }]
        ]);

        const secrets = await manager.loadSecrets('config.json', 'development');
        
        expect(secrets).toEqual({
            DB_PASSWORD: 'op-secret',
            API_KEY: 'gcs-secret'
        });
    });

    it('should load secrets from different environment', async () => {
        // Set up mock environment config
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
            development: {
                "DB_PASSWORD": "op://vault/item/field",
                "API_KEY": "gcsm://projects/my-project/secrets/api-key/versions/1"
            },
            staging: {
                "DB_PASSWORD": "op://vault/item/staging-field",
                "API_KEY": "gcsm://projects/my-project/secrets/api-key/versions/2"
            }
        }));

        // Mock the providers with different values for staging
        manager['providers'] = new Map([
            ['op://', { getSecret: async () => 'staging-secret' }],
            ['gcsm://', { getSecret: async () => 'staging-api-key' }]
        ]);

        const secrets = await manager.loadSecrets('config.json', 'staging');
        
        expect(secrets).toEqual({
            DB_PASSWORD: 'staging-secret',
            API_KEY: 'staging-api-key'
        });
    });

    it('should throw error for unknown environment in environment config', async () => {
        // Set up mock environment config
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
            development: {
                "DB_PASSWORD": "op://vault/item/field"
            }
        }));

        await expect(manager.loadSecrets('config.json', 'production'))
            .rejects
            .toThrow(/Environment 'production' not found in config file/);
    });

    it('should pass through values with unknown provider prefix', async () => {
        // Set up mock flat config with unknown provider
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
            "TEST": "unknown://test"
        }));

        const secrets = await manager.loadSecrets('config.json');
        
        expect(secrets).toEqual({
            TEST: 'unknown://test'
        });
    });

    // New tests for variable substitution
    it('should substitute environment variables in secret paths', async () => {
        // Set environment variables
        process.env.PROJECT_ID = 'my-project';
        process.env.REGION = 'us-east-1';

        // Set up mock config with variable references
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
            "DB_PASSWORD": "gcsm://projects/${PROJECT_ID}/secrets/db-password/versions/latest",
            "API_KEY": "awssm://${REGION}/api-key"
        }));

        // Mock the providers
        manager['providers'] = new Map([
            ['gcsm://', { getSecret: async (path: string) => {
                expect(path).toBe('gcsm://projects/my-project/secrets/db-password/versions/latest');
                return 'db-password-value';
            }}],
            ['awssm://', { getSecret: async (path: string) => {
                expect(path).toBe('awssm://us-east-1/api-key');
                return 'api-key-value';
            }}]
        ]);

        const secrets = await manager.loadSecrets('config.json');
        
        expect(secrets).toEqual({
            DB_PASSWORD: 'db-password-value',
            API_KEY: 'api-key-value'
        });
    });

    it('should throw error for undefined environment variables', async () => {
        // Set up mock config with undefined variable reference
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
            "API_KEY": "gcsm://projects/${UNDEFINED_VAR}/secrets/api-key/versions/latest"
        }));

        await expect(manager.loadSecrets('config.json'))
            .rejects
            .toThrow(/Environment variable 'UNDEFINED_VAR' referenced in secret path.*is not defined/);
    });

    it('should handle multiple variable substitutions in one path', async () => {
        // Set environment variables
        process.env.PROJECT_ID = 'my-project';
        process.env.SECRET_NAME = 'api-key';
        process.env.VERSION = 'v1';

        // Set up mock config with multiple variable references
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
            "API_KEY": "gcsm://projects/${PROJECT_ID}/secrets/${SECRET_NAME}/versions/${VERSION}"
        }));

        // Mock the provider
        manager['providers'] = new Map([
            ['gcsm://', { getSecret: async (path: string) => {
                expect(path).toBe('gcsm://projects/my-project/secrets/api-key/versions/v1');
                return 'api-key-value';
            }}]
        ]);

        const secrets = await manager.loadSecrets('config.json');
        
        expect(secrets).toEqual({
            API_KEY: 'api-key-value'
        });
    });

    it('should handle environment variables in environment-specific config', async () => {
        // Set environment variables
        process.env.PROJECT_ID = 'my-project';
        process.env.ENV = 'dev';

        // Set up mock environment config with variable references
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
            development: {
                "API_KEY": "gcsm://projects/${PROJECT_ID}/secrets/${ENV}/api-key/versions/latest"
            }
        }));

        // Mock the provider
        manager['providers'] = new Map([
            ['gcsm://', { getSecret: async (path: string) => {
                expect(path).toBe('gcsm://projects/my-project/secrets/dev/api-key/versions/latest');
                return 'api-key-value';
            }}]
        ]);

        const secrets = await manager.loadSecrets('config.json', 'development');
        
        expect(secrets).toEqual({
            API_KEY: 'api-key-value'
        });
    });

    it('should pass through non-secret values directly', async () => {
        // Set up mock config with both secret and non-secret values
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
            "SECRET_VALUE": "op://vault/item/field",
            "NORMAL_VALUE": "just a regular value",
            "NUMBER_VALUE": "12345",
            "URL_VALUE": "https://example.com"
        }));

        // Mock the provider
        manager['providers'] = new Map([
            ['op://', { getSecret: async () => 'secret-value' }]
        ]);

        const secrets = await manager.loadSecrets('config.json');
        
        expect(secrets).toEqual({
            SECRET_VALUE: 'secret-value',
            NORMAL_VALUE: 'just a regular value',
            NUMBER_VALUE: '12345',
            URL_VALUE: 'https://example.com'
        });
    });
});

// Add tests for environment variable value escaping
describe('escapeEnvValue', () => {
    it('should handle simple values without escaping', () => {
        expect(escapeEnvValue('simple-value')).toBe('simple-value');
        expect(escapeEnvValue('123456')).toBe('123456');
        expect(escapeEnvValue('value_with_underscores')).toBe('value_with_underscores');
    });

    it('should escape values with spaces', () => {
        expect(escapeEnvValue('value with spaces')).toBe('"value with spaces"');
        expect(escapeEnvValue(' leading space')).toBe('" leading space"');
        expect(escapeEnvValue('trailing space ')).toBe('"trailing space "');
    });

    it('should escape values with quotes', () => {
        expect(escapeEnvValue('value "with" quotes')).toBe('"value \\"with\\" quotes"');
        expect(escapeEnvValue('value\'with\'quotes')).toBe('"value\'with\'quotes"');
    });

    it('should escape values with equals signs', () => {
        expect(escapeEnvValue('value=with=equals')).toBe('"value=with=equals"');
        expect(escapeEnvValue('key=value')).toBe('"key=value"');
        expect(escapeEnvValue('DATABASE_URL=postgres://user:pass@host/db')).toBe('"DATABASE_URL=postgres://user:pass@host/db"');
    });

    it('should escape values starting with # (comments)', () => {
        expect(escapeEnvValue('#comment')).toBe('"#comment"');
        expect(escapeEnvValue('value#hash')).toBe('"value#hash"');
    });

    it('should escape values with $ (prevent expansion)', () => {
        expect(escapeEnvValue('$HOME')).toBe('"\\$HOME"');
        expect(escapeEnvValue('path:$PATH')).toBe('"path:\\$PATH"');
        expect(escapeEnvValue('dollar$ign')).toBe('"dollar\\$ign"');
    });

    it('should escape values with newlines', () => {
        expect(escapeEnvValue('value\nwith\nnewlines')).toBe('"value\\nwith\\nnewlines"');
        expect(escapeEnvValue('value\r\nwith\r\nwindows\r\nnewlines')).toBe('"value\\r\\nwith\\r\\nwindows\\r\\nnewlines"');
    });

    it('should handle JSON values', () => {
        const obj = { key: 'value', nested: { array: [1, 2, 3] } };
        const jsonValue = JSON.stringify(obj, null, 2); // Pretty print with indentation
        const escaped = escapeEnvValue(jsonValue);
        
        // The escaped value should be wrapped in single quotes
        expect(escaped.startsWith("'")).toBe(true);
        expect(escaped.endsWith("'")).toBe(true);
        
        // Should not contain any newlines
        expect(escaped.includes('\n')).toBe(false);
        expect(escaped.includes('\r')).toBe(false);
        
        // Should not have escaped quotes inside JSON
        expect(escaped.includes('\\"')).toBe(false);
        
        // Remove the outer quotes and parse
        const parsed = JSON.parse(escaped.slice(1, -1));
        expect(parsed).toEqual(obj);
        
        // The JSON structure should be preserved but compacted
        expect(escaped).toBe(`'${JSON.stringify(obj)}'`);
    });

    it('should handle multiline JSON values', () => {
        const jsonValue = `{
            "key": "value",
            "nested": {
                "data": true,
                "array": [
                    1,
                    2,
                    3
                ]
            }
        }`;
        const escaped = escapeEnvValue(jsonValue);
        
        // Should not contain any newlines or multiple spaces
        expect(escaped.includes('\n')).toBe(false);
        expect(escaped.includes('\r')).toBe(false);
        expect(escaped.includes('  ')).toBe(false);
        
        // Should not have escaped quotes
        expect(escaped.includes('\\"')).toBe(false);
        
        // Should still be valid JSON after removing outer quotes
        const parsed = JSON.parse(escaped.slice(1, -1));
        expect(parsed).toEqual({
            key: 'value',
            nested: {
                data: true,
                array: [1, 2, 3]
            }
        });
    });

    it('should handle JSON with embedded newlines', () => {
        const obj = {
            key: 'value',
            multiline: 'line1\nline2\nline3',
            nested: {
                text: 'hello\r\nworld'
            }
        };
        const jsonValue = JSON.stringify(obj, null, 2); // Pretty print with indentation
        const escaped = escapeEnvValue(jsonValue);
        
        // The escaped value should be wrapped in single quotes
        expect(escaped.startsWith("'")).toBe(true);
        expect(escaped.endsWith("'")).toBe(true);
        
        // Should not contain any raw newlines
        expect(escaped.includes('\n')).toBe(false);
        expect(escaped.includes('\r')).toBe(false);
        
        // Should have properly escaped newlines in the JSON
        const json = escaped.slice(1, -1); // Remove outer quotes
        expect(json.includes('\\n')).toBe(true); // Should have JSON newlines
        expect(json.includes('\\r\\n')).toBe(true); // Should have JSON CRLF
        
        // Should parse correctly
        const parsed = JSON.parse(json);
        expect(parsed).toEqual(obj);
        
        // Verify the newlines are preserved in the parsed object
        expect(parsed.multiline.split('\n').length).toBe(3);
        expect(parsed.nested.text.includes('\r\n')).toBe(true);
    });
}); 