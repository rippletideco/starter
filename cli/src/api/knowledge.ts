import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { logger } from '../utils/logger.js';

let client = axios.create({
  baseURL: 'https://rippletide-backend.azurewebsites.net',
  headers: {
    'Content-Type': 'application/json',
  },
});

let API_KEY: string | null = null;

export function setApiClient(newClient: any, apiKey: string | null) {
  client = newClient;
  API_KEY = apiKey;
}

export async function healthCheck() {
  const response = await client.get('/health');
  return response.data;
}

export async function checkKnowledge(folderPath: string = '.') {
  try {
    const knowledgeFiles = [
      'knowledge-base/qanda.json',
      'qanda.json',
      'knowledge.json',
    ];
    
    for (const file of knowledgeFiles) {
      const filePath = path.join(folderPath, file);
      if (fs.existsSync(filePath)) {
        return { found: true, path: filePath };
      }
    }
    
    return { found: false };
  } catch (error) {
    logger.error('Error checking knowledge:', error);
    return { found: false };
  }
}

export async function importKnowledge(agentId: string, knowledgeData: any) {
  try {
    const response = await client.post(`/api/agents/${agentId}/knowledge/import`, {
      data: knowledgeData,
    });
    
    return response.data;
  } catch (error) {
    logger.error('Error importing knowledge:', error);
    return null;
  }
}

export async function getTestResults(agentId: string) {
  try {
    const response = await client.get(`/api/agents/${agentId}/test-results`);
    return response.data;
  } catch (error) {
    console.error('Error getting test results:', error);
    return [];
  }
}

export interface EvaluationConfig {
  agentEndpoint: string;
  knowledgeSource?: string;
}

export interface EvaluationResult {
  totalTests: number;
  passed: number;
  failed: number;
  duration: string;
  evaluationUrl: string;
  agentId?: string;
}

export async function runEvaluation(
  config: EvaluationConfig, 
  onProgress?: (progress: number) => void
) {
  const { 
    generateApiKey, 
    createAgent, 
    addTestPrompts, 
    runAllPromptEvaluations 
  } = await import('./evaluation.js');
  
  try {
    const startTime = Date.now();
    
    if (onProgress) onProgress(10);
    const agent = await createAgent(config.agentEndpoint);
    const agentId = agent.id;
    
    if (onProgress) onProgress(30);
    if (config.knowledgeSource === 'files') {
      const knowledgeResult = await checkKnowledge();
      if (knowledgeResult.found && knowledgeResult.path) {
        const knowledgeData = JSON.parse(fs.readFileSync(knowledgeResult.path, 'utf-8'));
        await importKnowledge(agentId, knowledgeData);
      }
    }
    
    if (onProgress) onProgress(40);
    
    let testPrompts: string[] = [];
    if (config.knowledgeSource === 'files') {
      const knowledgeResult = await checkKnowledge();
      if (knowledgeResult.found && knowledgeResult.path) {
        try {
          const knowledgeData = JSON.parse(fs.readFileSync(knowledgeResult.path, 'utf-8'));
          if (Array.isArray(knowledgeData)) {
            testPrompts = knowledgeData.slice(0, 5).map((item: any) => 
              item.question || item.prompt || item.input || 'Test question'
            );
          } else if (knowledgeData.questions) {
            testPrompts = knowledgeData.questions.slice(0, 5);
          }
        } catch (error) {
          logger.error('Error loading prompts from knowledge:', error);
        }
      }
    }
    
    const createdPrompts = await addTestPrompts(agentId, testPrompts);
    const promptIds = createdPrompts.map((p: any) => p.id);
    const promptCount = promptIds.length;
    
    if (onProgress) onProgress(50);
    const evaluationResults = await runAllPromptEvaluations(
      agentId, 
      createdPrompts,
      config.agentEndpoint,
      (current, total) => {
        const progress = 50 + Math.round((current / total) * 40);
        if (onProgress) onProgress(progress);
      }
    );
    
    if (onProgress) onProgress(100);
    
    let passed = 0;
    let failed = 0;
    
    evaluationResults.forEach((result: any) => {
      if (result.success) {
        passed++;
      } else {
        failed++;
      }
    });
    
    const duration = Math.round((Date.now() - startTime) / 1000);
    const durationStr = duration > 60 
      ? `${Math.floor(duration / 60)}m ${duration % 60}s`
      : `${duration}s`;
    
    return {
      totalTests: promptCount || 5,
      passed,
      failed,
      duration: durationStr,
      evaluationUrl: `http://localhost:5173/eval/${agentId}`,
      agentId,
    };
  } catch (error) {
    logger.error('Evaluation error:', error);
    throw error;
  }
}

