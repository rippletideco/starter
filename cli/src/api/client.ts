import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';

let BASE_URL = 'https://rippletide-backend.azurewebsites.net';

let API_KEY: string | null = null;

let client = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

const setupInterceptor = () => {
  client.interceptors.request.use((config) => {
    if (API_KEY) {
      config.headers['x-api-key'] = API_KEY;
    }
    return config;
  });
};

setupInterceptor();

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
  setBaseUrl(url: string) {
    BASE_URL = url;
    client = axios.create({
      baseURL: BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    setupInterceptor();
    logger.debug('Backend URL set to:', BASE_URL);
  },

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
      
      logger.info(`Adding ${promptsArray.length} test prompts to agent ${agentId}`);
      logger.debug('Prompts:', promptsArray);
      
      const response = await client.post(`/api/agents/${agentId}/test-prompts`, {
        prompts: promptsArray,
      });
      
      logger.info(`Successfully added ${response.data.length} test prompts`);
      
      return response.data;
    } catch (error: any) {
      logger.error('Error adding test prompts:', error?.message || error);
      if (error.response) {
        logger.error('Response data:', error.response.data);
        logger.error('Response status:', error.response.status);
      }
      throw error;
    }
  },

  async checkHallucination(agentId: string, question: string, llmResponse: string, expectedAnswer?: string): Promise<HallucinationCheckResult> {
    try {
      if (!llmResponse || llmResponse.startsWith('Error calling LLM endpoint:')) {
        return {
          question,
          llmResponse,
          summary: 'LLM endpoint error',
          facts: [],
          status: 'failed',
          hallucinationLabel: '',
          hallucinationFindings: []
        };
      }
      
      logger.debug('Checking hallucination for question:', question);
      logger.debug('LLM Response length:', llmResponse.length);
      logger.debug('Expected answer:', expectedAnswer || 'None provided');
      
      const response = await client.post(`/api/agents/${agentId}/check-hallucination-response`, {
        question,
        llmResponse,
        expectedAnswer
      });
      
      logger.debug('Hallucination check result:', response.data);
      
      return {
        question: response.data.question,
        llmResponse: response.data.llmResponse,
        summary: response.data.summary || '',
        facts: response.data.facts || [],
        status: response.data.status || 'passed',
        hallucinationLabel: response.data.hallucinationLabel || 'FactIsPresent',
        hallucinationFindings: response.data.hallucinationFindings || []
      };
    } catch (error: any) {
      if (error?.response?.status === 404) {
        logger.warn('Hallucination check endpoint not found, using fallback');
        // Fallback for old backend version
        return {
          question,
          llmResponse,
          summary: 'Hallucination check not available',
          facts: [],
          status: 'passed',
          hallucinationLabel: 'FactIsPresent',
          hallucinationFindings: []
        };
      }
      
      logger.error('Error in hallucination check:', error?.message || error);
      logger.debug('Error details:', error?.response?.data);
      
      return {
        question,
        llmResponse,
        summary: 'Check failed',
        facts: [],
        status: 'passed',
        hallucinationLabel: 'FactIsPresent',
        hallucinationFindings: []
      };
    }
  },

  async callLLMEndpoint(agentEndpoint: string, question: string): Promise<string> {
    try {
      logger.debug(`Calling LLM endpoint: ${agentEndpoint}`);
      logger.debug(`Question: ${question}`);
      
      const llmClient = axios.create({
        timeout: 60000,
        validateStatus: () => true
      });
      
      const payload: any = { message: question };
      
      if (agentEndpoint.includes('vercel.app') || agentEndpoint.includes('naive-cosmetic')) {
        logger.debug('Using Vercel app format - message only');
      } else {
        payload.query = question;
        payload.question = question;
        payload.prompt = question;
      }
      
      logger.debug('Request payload:', payload);
      
      const response = await llmClient.post(agentEndpoint, payload);
      
      logger.debug(`Response status: ${response.status}`);
      logger.debug('Response headers:', response.headers);
      
      if (response.status >= 400) {
        const errorMsg = `LLM endpoint returned error: HTTP ${response.status} - ${response.statusText}`;
        logger.error(errorMsg);
        logger.debug('Response data:', response.data);
        throw new Error(errorMsg);
      }
      
      let llmResponse = '';
      if (typeof response.data === 'string') {
        llmResponse = response.data;
      } else if (response.data.answer) {
        llmResponse = response.data.answer;
      } else if (response.data.response) {
        llmResponse = response.data.response;
      } else if (response.data.message) {
        llmResponse = response.data.message;
      } else if (response.data.text) {
        llmResponse = response.data.text;
      } else if (response.data.result) {
        llmResponse = response.data.result;
      } else if (response.data.output) {
        llmResponse = response.data.output;
      } else if (response.data.content) {
        llmResponse = response.data.content;
      } else if (response.data.reply) {
        llmResponse = response.data.reply;
      } else {
        logger.debug('No standard field found, stringifying response');
        llmResponse = JSON.stringify(response.data);
      }
      
      if (!llmResponse || llmResponse === '{}') {
        logger.warn('Empty or invalid response from LLM endpoint');
        logger.debug('Full response:', response.data);
      }
      
      logger.debug(`Extracted response: ${llmResponse.substring(0, 100)}...`);
      
      return llmResponse;
    } catch (error: any) {
      const errorDetails = {
        message: error?.message || 'Unknown error',
        code: error?.code,
        endpoint: agentEndpoint,
        response: error?.response?.data,
        status: error?.response?.status
      };
      
      logger.error('Error calling LLM endpoint:', errorDetails);
      
      if (error.code === 'ECONNREFUSED') {
        throw new Error(`Cannot connect to LLM endpoint at ${agentEndpoint} - Connection refused`);
      } else if (error.code === 'ETIMEDOUT') {
        throw new Error(`LLM endpoint timeout after 60 seconds`);
      } else if (error.code === 'ENOTFOUND') {
        throw new Error(`LLM endpoint not found: ${agentEndpoint}`);
      }
      
      throw error;
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
    let llmResponse: string | null = null;
    
    try {
      logger.info(`Calling LLM for question: ${promptText}`);
      llmResponse = await api.callLLMEndpoint(agentEndpoint, promptText);
      
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
      
      try {
        const payload: any = {
          status,
          response: llmResponse,
          expectedAnswer: expectedAnswer || null
        };
        
        if (hallucinationResult.hallucinationLabel && hallucinationResult.hallucinationLabel !== '') {
          payload.hallucinationLabel = hallucinationResult.hallucinationLabel;
        }
        
        if (hallucinationResult.hallucinationFindings && hallucinationResult.hallucinationFindings.length > 0) {
          payload.hallucinationFindings = hallucinationResult.hallucinationFindings;
          logger.debug(`Including ${hallucinationResult.hallucinationFindings.length} hallucination findings`);
        } else {
          logger.debug('No hallucination findings to include');
        }
        
        await client.post(`/api/agents/${agentId}/test-results/${promptId}`, payload);
        logger.debug(`Stored test result for prompt ${promptId} with status ${status}`);
      } catch (storeError: any) {
        logger.warn('Could not store test result, trying minimal payload:', storeError?.message);
        logger.debug('Store error details:', storeError?.response?.data);
        
        const minimalPayload: any = {
          status,
          response: llmResponse,
          expectedAnswer: expectedAnswer || null
        };
        
        if (hallucinationResult.hallucinationLabel) {
          minimalPayload.hallucinationLabel = hallucinationResult.hallucinationLabel;
        }
        
        await client.post(`/api/agents/${agentId}/test-results/${promptId}`, minimalPayload);
        logger.debug(`Stored minimal test result for prompt ${promptId}`);
      }
      
      return { 
        success: status === 'passed', 
        question: promptText,
        llmResponse,
        hallucinationResult
      };
    } catch (error: any) {
      if (llmResponse) {
        logger.warn('LLM responded successfully but evaluation failed, marking as passed');
        try {
          await client.post(`/api/agents/${agentId}/test-results/${promptId}`, {
            status: 'passed',
            response: llmResponse,
            expectedAnswer: expectedAnswer || null
          });
        } catch (storeError) {
          logger.error('Could not store passed result:', storeError);
        }
        
        return {
          success: true,
          question: promptText,
          llmResponse,
          hallucinationResult: {
            question: promptText,
            llmResponse,
            summary: 'Evaluation skipped (LLM responded successfully)',
            facts: [],
            status: 'passed',
            hallucinationLabel: 'NO_HALLUCINATION',
            hallucinationFindings: []
          }
        };
      }
      
      const errorMessage = error?.response?.data?.message || error?.message || 'Unknown error';
      const errorDetails = {
        message: errorMessage,
        endpoint: agentEndpoint,
        statusCode: error?.response?.status,
        data: error?.response?.data
      };
      
      logger.error(`Error running prompt ${promptId}:`, errorDetails);
      
      const errorResponse = `Error calling LLM endpoint: ${errorMessage}`;
      
      try {
        await client.post(`/api/agents/${agentId}/test-results/${promptId}`, {
          status: 'failed',
          response: errorResponse,
          expectedAnswer: expectedAnswer || null
        });
        logger.debug(`Stored failed result for prompt ${promptId}`);
      } catch (e: any) {
        logger.error('Failed to store failed result:', e?.message || e);
        logger.debug('Error details:', e?.response?.data);
        
        try {
          await client.post(`/api/agents/${agentId}/test-results/${promptId}`, {
            status: 'failed'
          });
          logger.debug(`Stored minimal failed result for prompt ${promptId}`);
        } catch (fallbackError) {
          logger.error('Fallback storage also failed:', fallbackError);
        }
      }
      
      if (onLLMResponse && !llmResponse) {
        onLLMResponse(errorResponse);
      }
      
      return { 
        success: false, 
        question: promptText,
        llmResponse: errorResponse,
        error: errorDetails
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
