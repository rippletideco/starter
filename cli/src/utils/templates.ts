import * as fs from 'fs';
import * as path from 'path';

export interface TemplateConfig {
  endpoint_url: string;
  type?: string;
  knowledge_source?: string;
  pinecone_url?: string;
  pinecone_api_key?: string;
  postgresql_connection?: string;
  headers?: Record<string, string>;
  body_template?: string;
  response_field?: string;
  name?: string;
  description?: string;
}

export interface Template {
  name: string;
  path: string;
  config: TemplateConfig;
}

const getTemplatesDir = (): string => {
  const currentDir = process.cwd();
  const cliDir = path.resolve(currentDir);
  const templatesDir = path.join(cliDir, 'templates');
  
  if (!fs.existsSync(templatesDir)) {
    const altTemplatesDir = path.join(path.dirname(cliDir), 'cli', 'templates');
    if (fs.existsSync(altTemplatesDir)) {
      return altTemplatesDir;
    }
    
    const globalTemplatesDir = path.join(__dirname, '..', '..', 'templates');
    if (fs.existsSync(globalTemplatesDir)) {
      return globalTemplatesDir;
    }
  }
  
  return templatesDir;
};

export const listTemplates = (): Template[] => {
  const templates: Template[] = [];
  const templatesDir = getTemplatesDir();
  
  if (!fs.existsSync(templatesDir)) {
    return templates;
  }
  
  const dirs = fs.readdirSync(templatesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  for (const dir of dirs) {
    const configPath = path.join(templatesDir, dir, 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        const configContent = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(configContent) as TemplateConfig;
        templates.push({
          name: dir,
          path: path.join(templatesDir, dir),
          config: {
            ...config,
            name: config.name || dir,
            description: config.description || `Template: ${dir}`
          }
        });
      } catch (error) {
        console.error(`Error loading template ${dir}:`, error);
      }
    }
  }
  
  return templates;
};

export const loadTemplate = (templateName: string): Template | null => {
  const templates = listTemplates();
  const template = templates.find(t => 
    t.name.toLowerCase() === templateName.toLowerCase() ||
    t.config.name?.toLowerCase() === templateName.toLowerCase()
  );
  
  return template || null;
};

export const getTemplateOptions = (template: Template): any => {
  const config = template.config;
  return {
    agentEndpoint: config.endpoint_url,
    knowledgeSource: config.knowledge_source || 'files',
    pineconeUrl: config.pinecone_url,
    pineconeApiKey: config.pinecone_api_key,
    postgresqlConnection: config.postgresql_connection,
    headers: config.headers,
    bodyTemplate: config.body_template,
    responseField: config.response_field,
    nonInteractive: true,
    templatePath: template.path
  };
};
