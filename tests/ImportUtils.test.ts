import { describe, it, expect } from 'vitest';
import { parseEnvContent, truncateValueForDisplay, generateConfig, validatePathComponents } from '../src/lib/ImportUtils.js';
import { generateTestId } from './test-utils.js';

describe('parseEnvContent', () => {
    it('should parse simple KEY=VALUE pairs', () => {
        const content = 'API_KEY=secret123\nDB_URL=postgres://localhost';
        const result = parseEnvContent(content);
        
        expect(result).toEqual({
            API_KEY: 'secret123',
            DB_URL: 'postgres://localhost'
        });
    });

    it('should handle quoted values', () => {
        const content = 'DOUBLE="double quoted"\nSINGLE=\'single quoted\'';
        const result = parseEnvContent(content);
        
        expect(result).toEqual({
            DOUBLE: 'double quoted',
            SINGLE: 'single quoted'
        });
    });

    it('should handle JSON in unquoted values', () => {
        const content = 'CONFIG={"key":"value","number":42}';
        const result = parseEnvContent(content);
        
        expect(result.CONFIG).toBe('{"key":"value","number":42}');
        // Verify it's valid JSON
        expect(JSON.parse(result.CONFIG)).toEqual({ key: 'value', number: 42 });
    });

    it('should handle JSON in double-quoted values', () => {
        const content = 'CONFIG="{\\\"key\\\":\\\"value\\\",\\\"nested\\\":{\\\"data\\\":\\\"test\\\"}}"';
        const result = parseEnvContent(content);
        
        // After unquoting and unescaping, should be valid JSON string
        expect(result.CONFIG).toBe('{"key":"value","nested":{"data":"test"}}');
        expect(JSON.parse(result.CONFIG)).toEqual({ 
            key: 'value', 
            nested: { data: 'test' }
        });
    });

    it('should handle complex nested JSON', () => {
        const content = 'COMPLEX={"api":{"key":"abc123","secret":"xyz789"},"endpoints":["https://api1.com","https://api2.com"],"enabled":true}';
        const result = parseEnvContent(content);
        
        const parsed = JSON.parse(result.COMPLEX);
        expect(parsed.api.key).toBe('abc123');
        expect(parsed.endpoints).toHaveLength(2);
        expect(parsed.enabled).toBe(true);
    });

    it('should handle URLs with special characters', () => {
        const content = 'DATABASE_URL=postgres://user:p@ssw0rd!@localhost:5432/mydb?sslmode=require\nAPI_URL=https://api.example.com/v1/endpoint?key=abc&token=xyz';
        const result = parseEnvContent(content);
        
        expect(result.DATABASE_URL).toBe('postgres://user:p@ssw0rd!@localhost:5432/mydb?sslmode=require');
        expect(result.API_URL).toBe('https://api.example.com/v1/endpoint?key=abc&token=xyz');
    });

    it('should handle values with = signs in them', () => {
        const content = 'BASE64="SGVsbG8gV29ybGQ="\nEQUATION=a=b+c';
        const result = parseEnvContent(content);
        
        expect(result.BASE64).toBe('SGVsbG8gV29ybGQ=');
        expect(result.EQUATION).toBe('a=b+c');
    });

    it('should handle escaped characters in double quotes', () => {
        const content = 'ESCAPED="line1\\nline2\\ttabbed\\r\\nwindows"';
        const result = parseEnvContent(content);
        
        expect(result.ESCAPED).toBe('line1\nline2\ttabbed\r\nwindows');
    });

    it('should handle escaped quotes', () => {
        const content = 'QUOTED="He said \\"Hello\\" to me"';
        const result = parseEnvContent(content);
        
        expect(result.QUOTED).toBe('He said "Hello" to me');
    });

    it('should handle single quotes literally (no escaping)', () => {
        const content = 'LITERAL=\'This has \\n and \\" but they are literal\'';
        const result = parseEnvContent(content);
        
        expect(result.LITERAL).toBe('This has \\n and \\" but they are literal');
    });

    it('should handle multi-line double-quoted values', () => {
        const content = 'MULTILINE="line1\nline2\nline3"';
        const result = parseEnvContent(content);
        
        expect(result.MULTILINE).toBe('line1\nline2\nline3');
    });

    it('should handle multi-line single-quoted values', () => {
        const content = 'MULTILINE=\'line1\nline2\nline3\'';
        const result = parseEnvContent(content);
        
        expect(result.MULTILINE).toBe('line1\nline2\nline3');
    });

    it('should ignore comments', () => {
        const content = '# This is a comment\nAPI_KEY=secret\n# Another comment';
        const result = parseEnvContent(content);
        
        expect(result).toEqual({
            API_KEY: 'secret'
        });
    });

    it('should handle inline comments', () => {
        const content = 'KEY=value # this is a comment';
        const result = parseEnvContent(content);
        
        expect(result.KEY).toBe('value');
    });

    it('should not treat # as comment if part of value', () => {
        const content = 'HASH=abc#123';
        const result = parseEnvContent(content);
        
        expect(result.HASH).toBe('abc#123');
    });

    it('should handle empty lines', () => {
        const content = 'KEY1=value1\n\n\nKEY2=value2\n\n';
        const result = parseEnvContent(content);
        
        expect(result).toEqual({
            KEY1: 'value1',
            KEY2: 'value2'
        });
    });

    it('should support export KEY=value syntax', () => {
        const content = 'export API_KEY=secret\n export DB_URL=postgres://localhost';
        const result = parseEnvContent(content);
        expect(result).toEqual({
            API_KEY: 'secret',
            DB_URL: 'postgres://localhost'
        });
    });

    it('should ignore trailing content after closing quote (double quotes)', () => {
        const content = 'JSON="{\\\"a\\\":1}" # comment after value';
        const result = parseEnvContent(content);
        expect(result.JSON).toBe('{"a":1}');
    });

    it('should ignore trailing content after closing quote (single quotes)', () => {
        const content = "JSON='{\"a\":1}' # trailing";
        const result = parseEnvContent(content);
        // Single quotes are literal - backslashes aren't escaped
        expect(result.JSON).toBe('{\"a\":1}');
    });

    it('should trim whitespace correctly for unquoted values', () => {
        const content = '  KEY1  =  value1  \n\tKEY2\t=\tvalue2\t';
        const result = parseEnvContent(content);
        
        expect(result).toEqual({
            KEY1: 'value1',
            KEY2: 'value2'
        });
    });

    it('should preserve whitespace in quoted values', () => {
        const content = 'SPACES="  spaces  "';
        const result = parseEnvContent(content);
        
        expect(result.SPACES).toBe('  spaces  ');
    });

    it('should handle lines without = sign', () => {
        const content = 'VALID=value\nINVALID_LINE\nANOTHER=test';
        const result = parseEnvContent(content);
        
        expect(result).toEqual({
            VALID: 'value',
            ANOTHER: 'test'
        });
    });

    it('should handle empty values', () => {
        const content = 'EMPTY=\nWITH_VALUE=something';
        const result = parseEnvContent(content);
        
        expect(result).toEqual({
            EMPTY: '',
            WITH_VALUE: 'something'
        });
    });

    it('should handle real-world .env file example', () => {
        const content = `# Database configuration
DATABASE_URL=postgres://user:password@localhost:5432/mydb
DB_POOL_SIZE=10

# API Keys
API_KEY=abc123def456
SECRET_KEY="this is a secret"

# JSON config
APP_CONFIG={"name":"MyApp","version":"1.0.0","features":["auth","api","admin"]}

# URLs
FRONTEND_URL=https://example.com/app?utm_source=direct&utm_medium=web
BACKEND_URL=http://localhost:3000

# Empty values
OPTIONAL_FEATURE=
`;
        
        const result = parseEnvContent(content);
        
        expect(result.DATABASE_URL).toBe('postgres://user:password@localhost:5432/mydb');
        expect(result.DB_POOL_SIZE).toBe('10');
        expect(result.API_KEY).toBe('abc123def456');
        expect(result.SECRET_KEY).toBe('this is a secret');
        expect(JSON.parse(result.APP_CONFIG)).toEqual({
            name: 'MyApp',
            version: '1.0.0',
            features: ['auth', 'api', 'admin']
        });
        expect(result.FRONTEND_URL).toBe('https://example.com/app?utm_source=direct&utm_medium=web');
        expect(result.BACKEND_URL).toBe('http://localhost:3000');
        expect(result.OPTIONAL_FEATURE).toBe('');
    });
});

describe('truncateValueForDisplay', () => {
    it('should truncate long values with ellipsis', () => {
        const longValue = 'a'.repeat(100);
        const result = truncateValueForDisplay(longValue, 60);
        
        expect(result).toBe('a'.repeat(60) + '...');
        expect(result.length).toBe(63);
    });

    it('should keep short values unchanged', () => {
        const shortValue = 'short value';
        const result = truncateValueForDisplay(shortValue, 60);
        
        expect(result).toBe('short value');
    });

    it('should handle empty strings', () => {
        const result = truncateValueForDisplay('', 60);
        
        expect(result).toBe('');
    });

    it('should use default maxLength of 60', () => {
        const longValue = 'x'.repeat(100);
        const result = truncateValueForDisplay(longValue);
        
        expect(result).toBe('x'.repeat(60) + '...');
    });

    it('should handle values exactly at maxLength', () => {
        const value = 'a'.repeat(60);
        const result = truncateValueForDisplay(value, 60);
        
        expect(result).toBe(value);
    });
});

describe('generateConfig', () => {
    it('should generate flat config in src/dst format when no environment specified', () => {
        const result = generateConfig({
            selectedVars: ['API_KEY', 'DB_URL'],
            envVars: { API_KEY: 'secret', DB_URL: 'postgres://localhost' },
            providerPaths: {
                API_KEY: 'op://vault/item/api-key',
                DB_URL: 'op://vault/item/db-url'
            }
        });
        
        expect(result).toEqual({
            src: {
                API_KEY: 'op://vault/item/api-key',
                DB_URL: 'op://vault/item/db-url'
            },
            dst: {}
        });
    });

    it('should generate nested config in src/dst format with environment', () => {
        const result = generateConfig({
            selectedVars: ['API_KEY'],
            envVars: { API_KEY: 'secret' },
            providerPaths: { API_KEY: 'op://vault/item/api-key' },
            environment: 'production'
        });
        
        expect(result).toEqual({
            production: {
                src: {
                    API_KEY: 'op://vault/item/api-key'
                },
                dst: {}
            }
        });
    });

    it('should handle JSON field access paths correctly', () => {
        const result = generateConfig({
            selectedVars: ['KEY1', 'KEY2'],
            envVars: { KEY1: 'val1', KEY2: 'val2' },
            providerPaths: {
                KEY1: 'op://vault/item/config::KEY1',
                KEY2: 'op://vault/item/config::KEY2'
            }
        });
        
        expect(result).toEqual({
            src: {
                KEY1: 'op://vault/item/config::KEY1',
                KEY2: 'op://vault/item/config::KEY2'
            },
            dst: {}
        });
    });

    it('should handle multiple variables', () => {
        const result = generateConfig({
            selectedVars: ['VAR1', 'VAR2', 'VAR3'],
            envVars: { VAR1: 'a', VAR2: 'b', VAR3: 'c' },
            providerPaths: {
                VAR1: 'path1',
                VAR2: 'path2',
                VAR3: 'path3'
            }
        });
        
        expect(result).toEqual({
            src: {
                VAR1: 'path1',
                VAR2: 'path2',
                VAR3: 'path3'
            },
            dst: {}
        });
    });
});

describe('validatePathComponents', () => {
    it('should pass when all required components provided', () => {
        const result = validatePathComponents(
            { vault: 'my-vault', item: 'my-item' },
            ['vault', 'item']
        );
        
        expect(result.valid).toBe(true);
        expect(result.missing).toEqual([]);
    });

    it('should fail when required components missing', () => {
        const result = validatePathComponents(
            { vault: 'my-vault' },
            ['vault', 'item']
        );
        
        expect(result.valid).toBe(false);
        expect(result.missing).toEqual(['item']);
    });

    it('should return list of missing components', () => {
        const result = validatePathComponents(
            {},
            ['vault', 'item', 'field']
        );
        
        expect(result.valid).toBe(false);
        expect(result.missing).toEqual(['vault', 'item', 'field']);
    });

    it('should treat empty strings as missing', () => {
        const result = validatePathComponents(
            { vault: 'my-vault', item: '   ' },
            ['vault', 'item']
        );
        
        expect(result.valid).toBe(false);
        expect(result.missing).toEqual(['item']);
    });

    it('should pass when no components required', () => {
        const result = validatePathComponents({}, []);
        
        expect(result.valid).toBe(true);
        expect(result.missing).toEqual([]);
    });
});

describe('End-to-end: Parse, Store as JSON Bundle, Retrieve', () => {
    it('should handle complete flow with JSON-embedded env vars', async () => {
        // This test requires 1Password to be configured
        if (!process.env.OP_SERVICE_ACCOUNT_TOKEN) {
            console.log('Skipping end-to-end test: OP_SERVICE_ACCOUNT_TOKEN not set');
            return;
        }

        const { OnePasswordProvider } = await import('../src/lib/providers/1Password.js');
        const { SecretsManager } = await import('../src/lib/SecretsManager.js');
        const { writeFileSync, unlinkSync } = await import('fs');
        
        const provider = new OnePasswordProvider();
        const manager = new SecretsManager();
        const testId = generateTestId('test-import-e2e');
        const configPath = `${testId}.json`;
        
        // Step 1: Parse .env content with various complex values
        const envContent = `# Test config
API_KEY=secret123
DATABASE_URL=postgres://user:p@ss@localhost:5432/db
JSON_CONFIG={"database":{"host":"localhost","port":5432},"api":{"endpoint":"https://api.example.com/v1","timeout":30}}
ENCODED=SGVsbG8gV29ybGQ=
URL_PARAMS=https://example.com?foo=bar&baz=qux`;

        const envVars = parseEnvContent(envContent);
        
        expect(envVars.API_KEY).toBe('secret123');
        expect(envVars.DATABASE_URL).toBe('postgres://user:p@ss@localhost:5432/db');
        expect(envVars.ENCODED).toBe('SGVsbG8gV29ybGQ=');
        
        // Verify JSON is parseable
        const jsonConfig = JSON.parse(envVars.JSON_CONFIG);
        expect(jsonConfig.database.host).toBe('localhost');
        expect(jsonConfig.api.endpoint).toBe('https://api.example.com/v1');
        
        // Step 2: Store as JSON bundle in 1Password
        const itemName = generateTestId('test-import-bundle');
        const jsonBundle = JSON.stringify(envVars);
        const bundlePath = `op://testing/${itemName}/config`;
        
        try {
            await provider.setSecret(bundlePath, jsonBundle);
            
            // Step 3: Retrieve the bundle directly
            const retrievedBundle = await provider.getSecret(bundlePath);
            const retrievedVars = JSON.parse(retrievedBundle);
            
            // Step 4: Verify all values came through correctly
            expect(retrievedVars.API_KEY).toBe('secret123');
            expect(retrievedVars.DATABASE_URL).toBe('postgres://user:p@ss@localhost:5432/db');
            expect(retrievedVars.ENCODED).toBe('SGVsbG8gV29ybGQ=');
            expect(retrievedVars.URL_PARAMS).toBe('https://example.com?foo=bar&baz=qux');
            
            // Verify nested JSON is still valid
            const retrievedJsonConfig = JSON.parse(retrievedVars.JSON_CONFIG);
            expect(retrievedJsonConfig.database.host).toBe('localhost');
            expect(retrievedJsonConfig.api.endpoint).toBe('https://api.example.com/v1');
            
            // Step 5: Test JSON field access via SecretsManager (simulating actual salakala usage)
            const testConfig = {
                API_KEY: `${bundlePath}::API_KEY`,
                DATABASE_URL: `${bundlePath}::DATABASE_URL`,
                JSON_CONFIG: `${bundlePath}::JSON_CONFIG`,
                ENCODED: `${bundlePath}::ENCODED`
            };
            
            writeFileSync(configPath, JSON.stringify(testConfig, null, 2));
            
            const loadedSecrets = await manager.loadSecrets(configPath);
            
            // Verify salakala correctly extracts fields from JSON bundle
            expect(loadedSecrets.API_KEY).toBe('secret123');
            expect(loadedSecrets.DATABASE_URL).toBe('postgres://user:p@ss@localhost:5432/db');
            expect(loadedSecrets.ENCODED).toBe('SGVsbG8gV29ybGQ=');
            
            // Verify the nested JSON config is still valid after extraction
            const finalJsonConfig = JSON.parse(loadedSecrets.JSON_CONFIG);
            expect(finalJsonConfig.database.host).toBe('localhost');
            expect(finalJsonConfig.api.endpoint).toBe('https://api.example.com/v1');
            
            // Cleanup - add delay to avoid 409 conflicts
            await new Promise(resolve => setTimeout(resolve, 1000));
            await provider.deleteSecret(bundlePath);
            unlinkSync(configPath);
            
        } catch (error) {
            // Cleanup on error
            try {
                await new Promise(resolve => setTimeout(resolve, 1000));
                await provider.deleteSecret(bundlePath);
                unlinkSync(configPath);
            } catch {}
            throw error;
        }
    }, 35000);

    it('should correctly escape and unescape special characters through the cycle', async () => {
        // Test that special characters survive: parse → JSON bundle → retrieve
        const envContent = `QUOTES="value with \\"quotes\\""
NEWLINES="line1\\nline2\\nline3"
BACKSLASH="path\\\\to\\\\file"
MIXED={"key":"value with \\"quotes\\"","path":"C:\\\\Users\\\\test"}`;

        const envVars = parseEnvContent(envContent);
        
        expect(envVars.QUOTES).toBe('value with "quotes"');
        expect(envVars.NEWLINES).toBe('line1\nline2\nline3');
        expect(envVars.BACKSLASH).toBe('path\\to\\file');
        
        // Verify the JSON value is parseable and correct
        const mixed = JSON.parse(envVars.MIXED);
        expect(mixed.key).toBe('value with "quotes"');
        expect(mixed.path).toBe('C:\\Users\\test');
        
        // Create JSON bundle
        const bundle = JSON.stringify(envVars);
        const reparsed = JSON.parse(bundle);
        
        // Verify all values survived the round-trip
        expect(reparsed.QUOTES).toBe('value with "quotes"');
        expect(reparsed.NEWLINES).toBe('line1\nline2\nline3');
        expect(reparsed.BACKSLASH).toBe('path\\to\\file');
        
        const remixed = JSON.parse(reparsed.MIXED);
        expect(remixed.key).toBe('value with "quotes"');
        expect(remixed.path).toBe('C:\\Users\\test');
    });
});

