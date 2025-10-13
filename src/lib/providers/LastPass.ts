import { SecretProvider, PathComponentType } from '../SecretProvider.js';
import { CliHandler } from '../CliHandler.js';
import inquirer from 'inquirer';
import { EMOJI } from '../constants.js';

type LastPassItem = {
    id: string;
    name: string;
    fullname: string;
    username?: string;
    password?: string;
    group?: string;
    url?: string;
    note?: string;
}

/**
 * Provider for accessing secrets stored in LastPass using the LastPass CLI (lpass).
 * This implementation requires the LastPass CLI to be installed and configured.
 * 
 * The authentication state is cached after the first successful login
 * and reused for subsequent requests until the program terminates.
 * 
 * @implements {SecretProvider}
 * @see {@link https://github.com/lastpass/lastpass-cli} for LastPass CLI documentation
 */
export class LastPassProvider extends SecretProvider {
    readonly supportsMultipleFields = true;
    readonly pathComponents = [
        { name: 'folder', type: PathComponentType.Folder, description: 'Folder path', required: true },
        { name: 'item', type: PathComponentType.Item, description: 'Item name', required: true },
    ];

    /**
     * Flag indicating whether we have successfully logged in in this session.
     * @private
     */
    private isLoggedIn: boolean = false;
    private cli: CliHandler;
    private folders: string[] = [];

    constructor() {
        super();
        this.cli = new CliHandler();
    }

    buildPath(components: Record<string, string>, opts?: { fieldName?: string }): string {
        const { folder, item } = components;
        const fieldName = opts?.fieldName || 'password';
        return `lp://${folder}/${item}/${fieldName}`;
    }

    async checkLogin() {
        const result = await this.cli.run('lpass status');
        if(result.state !== "ok" && result.state !== 'error') {
            throw new Error(result.error?.message || result.message || 'Unable to run lpass status');
        }
        if(result.stdout.includes('Not logged in')) {
            this.isLoggedIn = false;
            console.log(`${EMOJI.ERROR} LastPass CLI is not logged in.`);
            await this.tryLogin();
        } else if(result.stdout.includes('Logged in as')) {
            this.isLoggedIn = true;
            console.log(`${EMOJI.SUCCESS} LastPass CLI is logged in.`);
        } else {
            console.error(result);
            throw new Error('Failed to parse lpass status output');
        }
    }

    async getItems(): Promise<{ path: string, id: string }[]> {
        const result = await this.cli.run('lpass ls --color=never');
        const lines = result.stdout.split('\n').filter(line => line.trim() !== '');
        return lines.map(line => {
            const match = line.match(/^(.+)\/(.+)\s+\[id: (\d+)\]/);
            if(!match) {
                return null;
            }
            let [, folder, itemName, id] = match;
            if(folder === '(none)') {
                folder = '';
            } else {
                folder += '/';
            }
            return {path: `${folder}${itemName}`, id};
        }).filter((m): m is { path: string, id: string } => m !== null);
    }

    async tryLogin() {
        console.log('The LastPass CLI needs your username to be passed in as an argument when logging in. Please enter it now.');
        const promptResult = await inquirer.prompt({
            type: 'input',
            name: 'username',
            message: 'Enter your LastPass username:',
        });
        console.log(`${EMOJI.LOGIN} LastPass needs to login. You are interacting with LastPass CLI now.`);
        const result = await this.cli.run(`lpass login ${promptResult.username}`, {
            interactive: true,
        });
        if(result.state !== 'ok') {
            throw new Error(result.error?.message || result.message || 'Unable to run lpass login');
        }
        if(result.stdout.includes('Logged in as')) {
            this.isLoggedIn = true;
        } else if(result.stdout.includes('Failed to enter correct password')) {
            throw new Error('Failed to enter correct password');
        } else {
            console.error(result);
            throw new Error('Failed to parse lpass login output');
        }
    }

    /**
     * Retrieves a secret value from LastPass using the CLI.
     * 
     * @param {string} path - The LastPass secret reference path
     *                        Format: lp://group/item-name[/field][::jsonKey]
     *                        Example: lp://Development/API Keys/password
     *                        Example with JSON: lp://Development/config/notes::database.host
     * @returns {Promise<string>} The secret value
     * @throws {Error} If the path is invalid, authentication fails, or secret cannot be retrieved
     */
    async getSecret(path: string): Promise<string> {

        await this.checkLogin();

        const parsedPath = this.parsePath(path);
        const items = await this.getItems();
        let queryPath = parsedPath.path;
        let fieldName = 'password'; // Default field

        if(parsedPath.pathParts.length === 3) {
            queryPath = parsedPath.pathParts[0] + '/' + parsedPath.pathParts[1];
            fieldName = parsedPath.pathParts[2];
        }

        const item = items.find(item => item.path === queryPath);
        if(!item) {
            throw new Error(`Item '${queryPath}' not found`);
        }
        const itemId = item.id;

        const result = await this.cli.run(`lpass show --all -j "${itemId}"`);
        if(result.state !== 'ok') {
            throw new Error(result.error?.message || result.message || `Unable to run lpass show for path '${queryPath}'`);
        }
        const json = JSON.parse(result.stdout) as LastPassItem[];
        if(json.length === 0) {
            throw new Error(`No secret found at path '${queryPath}'`);
        }

        const itemData = json[0];
        let secretValue: string;

        // Get the appropriate field value
        switch(fieldName.toLowerCase()) {
            case 'password':
                secretValue = itemData.password || '';
                break;
            case 'username':
                secretValue = itemData.username || '';
                break;
            case 'url':
                secretValue = itemData.url || '';
                break;
            case 'note':
            case 'notes':
                secretValue = itemData.note || '';
                break;
            default:
                secretValue = itemData.password || '';
                break;
        }

        if (!secretValue) {
            throw new Error(`No value found for field '${fieldName}' in item '${queryPath}'`);
        }

        // If there's a JSON key, parse and extract the value
        if (parsedPath.jsonKey) {
            return this.returnPossibleJsonValue(secretValue, parsedPath.jsonKey);
        }

        return secretValue;
    }

    /**
     * Stores a secret value in LastPass.
     * Creates a new entry if it doesn't exist, or updates an existing field.
     * 
     * @param {string} path - The LastPass secret reference path
     *                        Format: lp://folder/item-name/field
     *                        Example: lp://work/api-credentials/password
     * @param {string} value - The secret value to store
     * @returns {Promise<void>}
     * @throws {Error} If the path is invalid or secret cannot be written
     */
    async setSecret(path: string, value: string): Promise<void> {
        await this.checkLogin();
        
        const parsedPath = this.parsePath(path);
        
        if (parsedPath.pathParts.length < 2) {
            throw new Error('LastPass path must include at least item name and field');
        }

        const itemName = parsedPath.pathParts.slice(0, -1).join('/');
        const fieldName = parsedPath.pathParts[parsedPath.pathParts.length - 1];

        try {
            // Check if item exists
            const showResponse = await this.cli.run(`lpass show "${itemName}" --json`);
            const itemExists = showResponse.state === 'ok';

            if (itemExists) {
                // Update existing item
                console.log(`${EMOJI.UPDATING} Updating LastPass item ${itemName}, field ${fieldName}...`);
                
                const escapedValue = this.cli.escapeShellValue(value);
                
                if (fieldName === 'password') {
                    const editResponse = await this.cli.run(`lpass edit --non-interactive --password='${escapedValue}' "${itemName}"`);
                    if (editResponse.state !== 'ok') {
                        throw new Error(editResponse.message || 'Failed to update password');
                    }
                } else if (fieldName === 'username') {
                    const editResponse = await this.cli.run(`lpass edit --non-interactive --username='${escapedValue}' "${itemName}"`);
                    if (editResponse.state !== 'ok') {
                        throw new Error(editResponse.message || 'Failed to update username');
                    }
                } else if (fieldName === 'url') {
                    const editResponse = await this.cli.run(`lpass edit --non-interactive --url='${escapedValue}' "${itemName}"`);
                    if (editResponse.state !== 'ok') {
                        throw new Error(editResponse.message || 'Failed to update URL');
                    }
                } else if (fieldName === 'note' || fieldName === 'notes') {
                    const editResponse = await this.cli.run(`lpass edit --non-interactive --notes='${escapedValue}' "${itemName}"`);
                    if (editResponse.state !== 'ok') {
                        throw new Error(editResponse.message || 'Failed to update notes');
                    }
                } else {
                    const escapedFieldValue = `${fieldName}:${escapedValue}`;
                    const editResponse = await this.cli.run(`lpass edit --non-interactive --field='${escapedFieldValue}' "${itemName}"`);
                    if (editResponse.state !== 'ok') {
                        throw new Error(editResponse.message || `Failed to update field ${fieldName}`);
                    }
                }
            } else {
                // Create new item
                console.log(`${EMOJI.CREATING} Creating LastPass item ${itemName}...`);
                
                const escapedValue = this.cli.escapeShellValue(value);
                
                // Build the add command based on field type
                let addCommand = `lpass add --non-interactive "${itemName}"`;
                
                if (fieldName === 'password') {
                    addCommand += ` --password='${escapedValue}'`;
                } else if (fieldName === 'username') {
                    addCommand += ` --username='${escapedValue}'`;
                } else if (fieldName === 'url') {
                    addCommand += ` --url='${escapedValue}'`;
                } else if (fieldName === 'note' || fieldName === 'notes') {
                    addCommand += ` --notes='${escapedValue}'`;
                } else {
                    const escapedFieldValue = `${fieldName}:${escapedValue}`;
                    addCommand += ` --field='${escapedFieldValue}'`;
                }
                
                const addResponse = await this.cli.run(addCommand);
                if (addResponse.state !== 'ok') {
                    throw new Error(addResponse.message || 'Failed to create item');
                }
            }
        } catch (error: unknown) {
            this.wrapProviderError(error, 'write', 'LastPass');
        }
    }

    /**
     * Deletes a secret from LastPass.
     * Deletes the entire item.
     * 
     * @param {string} path - The LastPass secret reference path
     *                        Format: lp://folder/item-name/field
     *                        Example: lp://work/api-credentials/password
     * @returns {Promise<void>}
     * @throws {Error} If the path is invalid or secret cannot be deleted
     */
    async deleteSecret(path: string): Promise<void> {
        await this.checkLogin();
        
        const parsedPath = this.parsePath(path);
        
        if (parsedPath.pathParts.length < 2) {
            throw new Error('LastPass path must include at least item name and field');
        }

        const itemName = parsedPath.pathParts.slice(0, -1).join('/');

        try {
            console.log(`${EMOJI.DELETING} Deleting LastPass item ${itemName}...`);
            const deleteResponse = await this.cli.run(`lpass rm "${itemName}"`);
            
            if (deleteResponse.state !== 'ok') {
                throw new Error(deleteResponse.message || 'Failed to delete item');
            }
        } catch (error: unknown) {
            this.wrapProviderError(error, 'delete', 'LastPass');
        }
    }

} 