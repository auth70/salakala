/**
 * Path component types for semantic classification
 */
export enum PathComponentType {
    Vault = 'vault',       // Top-level container (1Password vault, etc.)
    Item = 'item',         // Item/entry/secret that holds values
    Section = 'section',   // Optional grouping within an item
    Region = 'region',     // Geographic location (AWS region)
    Project = 'project',   // Cloud project/account
    Version = 'version',   // Version identifier
    Path = 'path',         // File system path
    Folder = 'folder',     // Folder/group container
    Host = 'host'          // Hostname/URL
}

/**
 * Path component definition for interactive prompts
 */
export interface PathComponent {
    name: string;
    type: PathComponentType;
    description: string;
    required: boolean;
    default?: string;
}

/**
 * Interface for secret management providers.
 * Each provider must implement this interface to provide consistent secret retrieval functionality.
 * Providers are responsible for handling their own authentication and secret access mechanisms.
 */
export abstract class SecretProvider {
    /**
     * Indicates whether this provider supports multiple fields in a single item.
     * true: Provider can store multiple key-value pairs in one item (e.g., 1Password, Bitwarden)
     * false: Provider stores one value per secret (e.g., AWS Secrets Manager, Google Cloud Secret Manager)
     */
    abstract readonly supportsMultipleFields: boolean;

    /**
     * Defines the path components that need to be collected from the user.
     * Used by the import command to interactively build provider-specific paths.
     */
    abstract readonly pathComponents: PathComponent[];

    /**
     * Builds a complete provider path from the given components.
     * 
     * @param {Record<string, string>} components - The path component values collected from user
     * @param {object} [opts] - Optional parameters
     * @param {string} [opts.fieldName] - Field name for multi-field providers or JSON key access
     * @returns {string} The complete provider URI (e.g., "op://vault/item/field")
     */
    abstract buildPath(components: Record<string, string>, opts?: { fieldName?: string }): string;

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

    /**
     * Wraps provider errors with consistent formatting.
     * Re-throws errors that are from our own validation (contain 'Key', 'JSON', or 'empty').
     * Wraps external provider errors with context.
     * 
     * @param {unknown} error - The error to wrap
     * @param {string} operation - Operation being performed (e.g., 'read', 'write', 'delete')
     * @param {string} providerName - Name of the provider (e.g., '1Password', 'AWS Secrets Manager')
     * @returns {never} Always throws
     */
    protected wrapProviderError(error: unknown, operation: string, providerName: string): never {
        if (error instanceof Error) {
            // Re-throw our own validation errors unchanged
            if (error.message.includes('Key') || 
                error.message.includes('JSON') || 
                error.message.includes('empty')) {
                throw error;
            }
            // Wrap provider errors with context
            throw new Error(`Failed to ${operation} ${providerName} secret: ${error.message}`);
        }
        throw new Error(`Failed to ${operation} ${providerName} secret: Unknown error`);
    }

    /**
     * Parses a path component using a regex pattern and validates format.
     * 
     * @param {string} path - The path component to parse
     * @param {RegExp} pattern - Regex pattern to match against
     * @param {string} expectedFormat - Human-readable description of expected format for error messages
     * @returns {RegExpMatchArray} The regex match array
     * @throws {Error} If the path doesn't match the expected format
     */
    protected parsePathWithRegex(path: string, pattern: RegExp, expectedFormat: string): RegExpMatchArray {
        const match = path.match(pattern);
        if (!match) {
            throw new Error(`Invalid path format. Expected: ${expectedFormat}`);
        }
        return match;
    }

    /**
     * Generic client caching for providers that need to maintain client instances.
     * 
     * @param {Map<string, T>} cache - The cache map to use
     * @param {string} key - Cache key
     * @param {() => T} factory - Factory function to create new client if not cached
     * @returns {T} The cached or newly created client
     */
    protected getOrCreateClient<T>(cache: Map<string, T>, key: string, factory: () => T): T {
        if (!cache.has(key)) {
            cache.set(key, factory());
        }
        return cache.get(key)!;
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
