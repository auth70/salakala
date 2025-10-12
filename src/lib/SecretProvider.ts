/**
 * Interface for secret management providers.
 * Each provider must implement this interface to provide consistent secret retrieval functionality.
 * Providers are responsible for handling their own authentication and secret access mechanisms.
 */
export abstract class SecretProvider {
    /**
     * Retrieves a secret value from the provider's storage.
     * For binary secrets, the value will be base64 encoded.
     * 
     * @param {string} path - The provider-specific path or identifier for the secret
     * @returns {Promise<string>} The secret value, base64 encoded if binary
     * @throws {Error} If the secret cannot be retrieved or the path is invalid
     */
    abstract getSecret(path: string): Promise<string>;
    /**
     * Stores a secret value in the provider's storage.
     * Creates a new secret if it doesn't exist, or updates/adds a version if it does.
     * 
     * @param {string} path - The provider-specific path or identifier for the secret
     * @param {string} value - The secret value to store
     * @returns {Promise<void>}
     * @throws {Error} If the secret cannot be written or the path is invalid
     */
    abstract setSecret(path: string, value: string): Promise<void>;
    /**
     * Deletes a secret from the provider's storage.
     * Optional method - not all providers may implement this.
     * 
     * @param {string} path - The provider-specific path or identifier for the secret
     * @returns {Promise<void>}
     * @throws {Error} If the secret cannot be deleted or the path is invalid
     */
    async deleteSecret(path: string): Promise<void> {
        throw new Error(`Delete operation not implemented for this provider`);
    }
    /**
     * Tries to parse a value as a JSON object and return the value of the given key.
     * @param {string} value - The value to parse as a JSON object
     * @param {string} key - The key to return the value of
     * @returns {string} The value of the given key or the original value if parsing fails
     */
    returnPossibleJsonValue(value: string, key?: string): string {
        try {
            // Try to parse the value as a JSON object
            const json = JSON.parse(value);
            if(key) {
                // If a key is provided, try to retrieve the value from the JSON object
                const result = this.getFromObjWithStringPath(json, key);
                if(result !== undefined) {
                    return result.toString();
                } else {
                    throw new Error(`Key ${key} not found in JSON object`);
                }
            } else {
                // If no key is provided, return the JSON object as a string
                return JSON.stringify(json);
            }
        } catch (e) {
            // Re-throw key not found errors, but ignore JSON parsing errors
            if (e instanceof Error && e.message.includes('Key') && e.message.includes('not found')) {
                throw e;
            }
            // For JSON parsing errors, return the original value
            return value;
        }
    }
    /**
     * Parses a URI into its components.
     * @param {string} uri - The URI to parse
     * @returns {Object} An object containing the parsed URI components
     */
    parsePath(uri: string): {
        uri: string;
        scheme: string;
        path: string;
        pathParts: string[];
        jsonKey?: string;
    } {
        // Given an uri of the form: scheme://path/to/secret[::jsonKey]
        const regex = /^(\w+):\/\/([^:]+)(?:::(.+))?$/;
        const match = uri.match(regex);
        if (match) {
            return {
                uri,
                scheme: match[1],
                path: match[2],
                pathParts: match[2].split('/'),
                jsonKey: match[3]
            };
        }
        else {
            throw new Error(`Invalid URI: ${uri}`);
        }
    }
    /**
     * Retrieves a value from an object using a string path.
     * @param {any} obj - The object to search
     * @param {string} path - The path to the value
     * @returns {string | number | Date | boolean | object | undefined} The value at the given path or undefined if not found
     */
    getFromObjWithStringPath(obj: any, path: string): string | number | Date | boolean | object | undefined {
        if(!obj) return undefined;
        const parts = path.split('.');
        let current = obj;
    
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            // Support for array access patterns: foo[] or foo[0]
            const arrayMatch = part.match(/^(.+?)(\[\d*\])?$/);
    
            if (arrayMatch) {
                const [, key, indexPart] = arrayMatch;
    
                // Navigate into 'properties' if it exists
                if (current.properties && current.properties[key]) {
                    current = current.properties[key];
                } else if (current[key]) {
                    current = current[key];
                } else {
                    // The path is invalid for the given structure or the index is not a number
                    return undefined;
                }
    
                // If indexPart is defined, it means we're dealing with an array index
                if (indexPart) {
                    // Dealing with an array index, e.g., [0]
                    const index = parseInt(indexPart.slice(1, -1), 10);
                    if (!Array.isArray(current) || isNaN(index)) {
                        return undefined;
                    }
                    current = current[index];
                }
            } else {
                // Direct property access
                if (current.properties && current.properties[part]) {
                    current = current.properties[part];
                } else if (current[part]) {
                    current = current[part];
                } else {
                    return undefined;
                }
            }
    
            if (current === undefined) {
                return undefined;
            }
        }
    
        // The value must be directly returnable without checking type,
        // as we might be looking for an object structure.
        return current;
    }
}

/**
 * Configuration mapping for secrets.
 * Maps environment variable names to secret paths/identifiers.
 */
export interface SecretConfig {
    [key: string]: string;
}

/**
 * Configuration structure for multiple environments.
 * Maps environment names (e.g., 'development', 'production') to their respective secret configurations.
 */
export interface EnvironmentConfigs {
    [environment: string]: SecretConfig;
}
