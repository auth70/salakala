/**
 * Shared test data for import integration tests.
 * Used across all provider tests to ensure consistency.
 */

export const testEnvContent = `# Test configuration
SIMPLE_VALUE=test123
DATABASE_URL=postgres://user:p@ssw0rd!@localhost:5432/mydb?sslmode=require
API_ENDPOINT=https://api.example.com/v1/endpoint?key=abc&token=xyz
ENCODED_VALUE=SGVsbG8gV29ybGQ=
JSON_CONFIG={"database":{"host":"localhost","port":5432,"ssl":true},"api":{"endpoint":"https://api.example.com/v1","timeout":30,"retries":3}}
NESTED_JSON={"users":[{"name":"Alice","role":"admin"},{"name":"Bob","role":"user"}],"settings":{"theme":"dark","language":"en"}}
EMPTY_VALUE=
WITH_EQUALS=a=b+c
WITH_HASH=abc#123
MULTILINE="line1\\nline2\\nline3"`;

export const expectedParsedValues = {
    SIMPLE_VALUE: 'test123',
    DATABASE_URL: 'postgres://user:p@ssw0rd!@localhost:5432/mydb?sslmode=require',
    API_ENDPOINT: 'https://api.example.com/v1/endpoint?key=abc&token=xyz',
    ENCODED_VALUE: 'SGVsbG8gV29ybGQ=',
    JSON_CONFIG: '{"database":{"host":"localhost","port":5432,"ssl":true},"api":{"endpoint":"https://api.example.com/v1","timeout":30,"retries":3}}',
    NESTED_JSON: '{"users":[{"name":"Alice","role":"admin"},{"name":"Bob","role":"user"}],"settings":{"theme":"dark","language":"en"}}',
    EMPTY_VALUE: '',
    WITH_EQUALS: 'a=b+c',
    WITH_HASH: 'abc#123',
    MULTILINE: 'line1\nline2\nline3'
};

/**
 * Simple test values for basic read/write tests
 */
export const simpleTestVars = {
    API_KEY: 'secret123',
    DB_PASSWORD: 'postgres-pass'
};

/**
 * JSON-heavy test values
 */
export const jsonTestVars = {
    CONFIG: '{"key":"value","number":42}',
    COMPLEX: '{"api":{"key":"abc123","secret":"xyz789"},"endpoints":["https://api1.com","https://api2.com"],"enabled":true}'
};

/**
 * Standard JSON data for testing JSON field access
 */
export const standardJsonData = {
    key: 'test-json-value',
    nested: { value: 'nested-test-value' }
};

/**
 * Complex JSON data for testing array access
 */
export const complexJsonData = {
    foo: 'bar',
    baz: {
        lorem: ['ipsum', 'dolor']
    }
};

/**
 * JSON data for nested JSON in JSON tests
 */
export const nestedJsonData = {
    OUTER_JSON: '{"inner":{"nested":"value"},"array":[1,2,3]}'
};

/**
 * Test data for AWS/GCS provider tests (key-value secrets)
 */
export const keyValueJsonData = {
    'secret-key': 'secret-value',
    foo: 'bar'
};

/**
 * Expected values from static KeePass test database (tests/keepass.kdbx)
 * Password: 'password'
 */
export const keepassStaticData = {
    testEntry: {
        UserName: 'test',
        Password: 'testtest'
    },
    jsonTestEntry: {
        Notes: { key: 'test-json-value', nested: { value: 'nested-test-value' } }
    }
};

