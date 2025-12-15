import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';

const BASE_URL = 'http://localhost:3001';

let API_KEY: string | null = null;

const client = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

client.interceptors.request.use((config) => {
  if (API_KEY) {
    config.headers['x-api-key'] = API_KEY;
  }
  return config;
});

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

export interface HallucinationCheckResult {
  question: string;
  llmResponse: string;
  summary: string;
  facts: string[];
  status: 'passed' | 'failed' | 'ambiguous';
  hallucinationLabel: string;
  hallucinationFindings: any[];
}

export interface PromptEvaluationResult {
  success: boolean;
  question: string;
  llmResponse?: string;
  hallucinationResult?: HallucinationCheckResult;
  error?: any;
}

export const api = {
  async generateApiKey(name?: string) {
    try {
      const response = await client.post('/api/api-keys/generate-cli', {
        name: name || 'CLI Evaluation Key'
      });
      
      API_KEY = response.data.apiKey;
      logger.info('API key generated successfully');
      logger.debug('API Key:', API_KEY?.substring(0, 12) + '...');
      
      return response.data;
    } catch (error) {
      logger.error('Error generating API key:', error);
      throw error;
    }
  },

  async healthCheck() {
    const response = await client.get('/health');
    return response.data;
  },

  async checkKnowledge(folderPath: string = '.') {
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
  },

  async createAgent(publicUrl: string) {
    try {
      const response = await client.post('/api/agents', {
        name: `Agent Eval ${Date.now()}`,
        seed: Math.floor(Math.random() * 1000),
        numNodes: 100,
        publicUrl: publicUrl,
        label: 'eval',
      });
      
      return response.data;
    } catch (error) {
      logger.error('Error creating agent:', error);
      throw error;
    }
  },

  async importKnowledge(agentId: string, knowledgeData: any) {
    try {
      const response = await client.post(`/api/agents/${agentId}/knowledge/import`, {
        data: knowledgeData,
      });
      
      return response.data;
    } catch (error) {
      logger.error('Error importing knowledge:', error);
      return null;
    }
  },

  async addTestPrompts(agentId: string, prompts?: string[] | Array<{question: string, answer?: string}>) {
    try {
      const defaultPrompts = [
        'What can you help me with?',
        'Tell me about your capabilities',
        'How do I get started?',
        'What features do you support?',
        'Can you explain your main functionality?',
      ];
      
      let promptsArray: Array<{prompt: string, expectedAnswer: string | null}>;
      
      if (!prompts || prompts.length === 0) {
        promptsArray = defaultPrompts.map(p => ({ prompt: p, expectedAnswer: null }));
      } else if (typeof prompts[0] === 'string') {
        promptsArray = (prompts as string[]).map(p => ({ prompt: p, expectedAnswer: null }));
      } else {
        promptsArray = (prompts as Array<{question: string, answer?: string}>).map(p => ({
          prompt: p.question,
          expectedAnswer: p.answer || null,
        }));
      }
      
      const response = await client.post(`/api/agents/${agentId}/test-prompts`, {
        prompts: promptsArray,
      });
      
      return response.data;
    } catch (error: any) {
      logger.error('Error adding test prompts:', error);
      if (error.response) {
        logger.debug('Response data:', error.response.data);
        logger.debug('Response status:', error.response.status);
      }
      throw error;
    }
  },

  async checkHallucination(agentId: string, question: string, llmResponse: string, expectedAnswer?: string): Promise<HallucinationCheckResult> {
    const response = await client.post(`/api/agents/${agentId}/hallucination`, {
      question,
      llmResponse,
      expectedAnswer
    });
    return response.data;
  },

  async callLLMEndpoint(agentEndpoint: string, question: string): Promise<string> {
    try {
      const llmClient = axios.create({
        timeout: 60000,
      });
      
      const response = await llmClient.post(agentEndpoint, {
        message: question,
        query: question,
        question: question,
        prompt: question,
      });
      
      let llmResponse = '';
      if (typeof response.data === 'string') {
        llmResponse = response.data;
      } else if (response.data.response) {
        llmResponse = response.data.response;
      } else if (response.data.message) {
        llmResponse = response.data.message;
      } else if (response.data.answer) {
        llmResponse = response.data.answer;
      } else if (response.data.text) {
        llmResponse = response.data.text;
      } else {
        llmResponse = JSON.stringify(response.data);
      }
      
      return llmResponse;
    } catch (error: any) {
      logger.error('Error calling LLM endpoint:', error?.message || error);
      throw new Error(`Failed to call LLM endpoint: ${error?.message || 'Unknown error'}`);
    }
  },

  async runPromptEvaluation(
    agentId: string, 
    promptId: number, 
    promptText: string, 
    agentEndpoint: string,
    expectedAnswer?: string,
    onLLMResponse?: (response: string) => void
  ): Promise<PromptEvaluationResult> {
    try {
      logger.info(`Calling LLM for question: ${promptText}`);
      const llmResponse = await api.callLLMEndpoint(agentEndpoint, promptText);
      
      if (onLLMResponse) {
        onLLMResponse(llmResponse);
      }
      
      logger.info(`LLM Response: ${llmResponse.substring(0, 100)}...`);
      
      const hallucinationResult = await api.checkHallucination(
        agentId, 
        promptText, 
        llmResponse, 
        expectedAnswer
      );
      
      const status = hallucinationResult.status === 'passed' ? 'passed' : 'failed';
      await client.post(`/api/agents/${agentId}/test-results/${promptId}`, {
        status,
        response: llmResponse,
        hallucinationLabel: hallucinationResult.hallucinationLabel,
        hallucinationFindings: hallucinationResult.hallucinationFindings
      });
      
      return { 
        success: status === 'passed', 
        question: promptText,
        llmResponse,
        hallucinationResult
      };
    } catch (error: any) {
      logger.debug(`Error running prompt ${promptId}:`, error?.response?.data || error.message);
      
      try {
        await client.post(`/api/agents/${agentId}/test-results/${promptId}`, {
          status: 'failed'
        });
      } catch (e) {
        logger.debug('Failed to store failed result:', e);
      }
      
      return { 
        success: false, 
        question: promptText,
        error 
      };
    }
  },

  async runAllPromptEvaluations(
    agentId: string, 
    prompts: any[], 
    agentEndpoint: string,
    onProgress?: (current: number, total: number, question?: string, llmResponse?: string) => void
  ) {
    const results: PromptEvaluationResult[] = [];
    try {
      for (let i = 0; i < prompts.length; i++) {
        const prompt = prompts[i];
        
        if (onProgress) {
          onProgress(i + 1, prompts.length, prompt.prompt);
        }
        
        const result = await api.runPromptEvaluation(
          agentId, 
          prompt.id, 
          prompt.prompt,
          agentEndpoint,
          prompt.expectedAnswer,
          (llmResponse) => {
            if (onProgress) {
              onProgress(i + 1, prompts.length, prompt.prompt, llmResponse);
            }
          }
        );
        
        results.push(result);
        
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      logger.error('Error running evaluations:', error);
    }
    return results;
  },

  async getTestResults(agentId: string) {
    try {
      const response = await client.get(`/api/agents/${agentId}/test-results`);
      return response.data;
    } catch (error) {
      console.error('Error getting test results:', error);
      return [];
    }
  },

  async runEvaluation(config: EvaluationConfig, onProgress?: (progress: number) => void) {
    try {
      const startTime = Date.now();
      
      if (onProgress) onProgress(10);
      const agent = await api.createAgent(config.agentEndpoint);
      const agentId = agent.id;
      
      if (onProgress) onProgress(30);
      if (config.knowledgeSource === 'files') {
        const knowledgeResult = await api.checkKnowledge();
        if (knowledgeResult.found && knowledgeResult.path) {
          const knowledgeData = JSON.parse(fs.readFileSync(knowledgeResult.path, 'utf-8'));
          await api.importKnowledge(agentId, knowledgeData);
        }
      }
      
      if (onProgress) onProgress(40);
      
      let testPrompts: string[] = [];
      if (config.knowledgeSource === 'files') {
        const knowledgeResult = await api.checkKnowledge();
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
      
      const createdPrompts = await api.addTestPrompts(agentId, testPrompts);
      const promptIds = createdPrompts.map((p: any) => p.id);
      const promptCount = promptIds.length;
      
      if (onProgress) onProgress(50);
      const evaluationResults = await api.runAllPromptEvaluations(
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
      
      evaluationResults.forEach((result: PromptEvaluationResult) => {
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
  },
};
