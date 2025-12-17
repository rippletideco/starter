import React, { useState, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import { Header } from './components/Header.js';
import { TextInput } from './components/TextInput.js';
import { SelectMenu } from './components/SelectMenu.js';
import { Spinner } from './components/Spinner.js';
import { ProgressBar } from './components/ProgressBar.js';
import { Summary } from './components/Summary.js';
import { api } from './api/client.js';
import { getPineconeQAndA } from './utils/pinecone.js';

type Step = 
  | 'agent-endpoint' 
  | 'checking-knowledge' 
  | 'select-source' 
  | 'pinecone-url'
  | 'pinecone-api-key'
  | 'fetching-pinecone'
  | 'running-evaluation' 
  | 'complete';

const knowledgeSources = [
  { label: 'Local Files (qanda.json)', value: 'files', description: 'Use qanda.json from current directory' },
  { label: 'Pinecone', value: 'pinecone', description: 'Fetch Q&A from Pinecone database' },
  { label: 'Current Repository', value: 'repo', description: 'Scan current git repository', disabled: true },
  { label: 'Database', value: 'database', description: 'Connect to a database', disabled: true },
  { label: 'API Endpoint', value: 'api', description: 'Fetch from REST API', disabled: true },
  { label: 'GitHub Repository', value: 'github', description: 'Import from GitHub repo', disabled: true },
  { label: 'Skip (No Knowledge)', value: 'skip', description: 'Run tests without knowledge base', disabled: true },
];

interface AppProps {
  backendUrl?: string;
  dashboardUrl?: string;
}

export const App: React.FC<AppProps> = ({ backendUrl, dashboardUrl }) => {
  const [step, setStep] = useState<Step>('agent-endpoint');
  const [agentEndpoint, setAgentEndpoint] = useState('');
  const [knowledgeSource, setKnowledgeSource] = useState('');
  const [knowledgeFound, setKnowledgeFound] = useState(false);
  const [pineconeUrl, setPineconeUrl] = useState('');
  const [pineconeApiKey, setPineconeApiKey] = useState('');
  const [pineconeQAndA, setPineconeQAndA] = useState<Array<{question: string, answer: string}>>([]);
  const [pineconeProgress, setPineconeProgress] = useState('');
  const [evaluationProgress, setEvaluationProgress] = useState(0);
  const [evaluationResult, setEvaluationResult] = useState<any>(null);
  const [currentQuestion, setCurrentQuestion] = useState<string>('');
  const [currentLLMResponse, setCurrentLLMResponse] = useState<string>('');
  const [evaluationLogs, setEvaluationLogs] = useState<Array<{question: string, response: string}>>([]);

  useEffect(() => {
    if (backendUrl) {
      api.setBaseUrl(backendUrl);
    }
  }, [backendUrl]);

  useEffect(() => {
    if (step === 'checking-knowledge') {
      (async () => {
        try {
          const result = await api.checkKnowledge();
          setKnowledgeFound(result.found);
        } catch (error) {
          console.error('Error checking knowledge:', error);
          setKnowledgeFound(false);
        }
        setStep('select-source');
      })();
    }
  }, [step]);

  useEffect(() => {
    if (step === 'fetching-pinecone') {
      (async () => {
        try {
          const qaPairs = await getPineconeQAndA(
            pineconeUrl,
            pineconeApiKey,
            (message) => setPineconeProgress(message)
          );
          setPineconeQAndA(qaPairs);
          setStep('running-evaluation');
        } catch (error: any) {
          console.error('Error fetching Q&A from Pinecone:', error);
          setEvaluationResult({
            totalTests: 0,
            passed: 0,
            failed: 0,
            duration: 'Failed',
            evaluationUrl: dashboardUrl || 'https://eval.rippletide.com',
            error: error.message,
          });
          setStep('complete');
        }
      })();
    }
  }, [step, pineconeUrl, pineconeApiKey]);

  useEffect(() => {
    if (step === 'running-evaluation') {
      (async () => {
        try {
          const startTime = Date.now();
          const logs: Array<{question: string, response: string}> = [];
          
          setEvaluationProgress(5);
          await api.generateApiKey('CLI Evaluation');
          
          setEvaluationProgress(10);
          const agent = await api.createAgent(agentEndpoint);
          const agentId = agent.id;
          
          setEvaluationProgress(30);
          
          setEvaluationProgress(40);
          let testPrompts: Array<{question: string, answer?: string}> | string[] = [];
          if (knowledgeSource === 'files') {
            const knowledgeResult = await api.checkKnowledge();
            if (knowledgeResult.found && knowledgeResult.path) {
              try {
                const fs = await import('fs');
                const knowledgeData = JSON.parse(fs.readFileSync(knowledgeResult.path, 'utf-8'));
                if (Array.isArray(knowledgeData)) {
                  testPrompts = knowledgeData.slice(0, 5).map((item: any) => ({
                    question: item.question || item.prompt || item.input || 'Test question',
                    answer: item.answer || item.response || item.expectedAnswer
                  }));
                }
              } catch (error) {
                testPrompts = [];
              }
            }
          } else if (knowledgeSource === 'pinecone' && pineconeQAndA.length > 0) {
            testPrompts = pineconeQAndA.slice(0, 5).map((item) => ({
              question: item.question,
              answer: item.answer
            }));
          }
          
          const createdPrompts = await api.addTestPrompts(agentId, testPrompts);
          
          setEvaluationProgress(50);
          const evaluationResults = await api.runAllPromptEvaluations(
            agentId,
            createdPrompts,
            agentEndpoint,
            (current, total, question, llmResponse) => {
              const progress = 50 + Math.round((current / total) * 40);
              setEvaluationProgress(progress);
              
              if (question) {
                setCurrentQuestion(question);
              }
              if (llmResponse) {
                setCurrentLLMResponse(llmResponse);
                logs.push({ question: question || '', response: llmResponse });
                setEvaluationLogs([...logs]);
              }
            }
          );
          
          setEvaluationProgress(100);
          
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
          
          const result = {
            totalTests: createdPrompts.length,
            passed,
            failed,
            duration: durationStr,
            evaluationUrl: `${dashboardUrl || 'https://eval.rippletide.com'}/eval/${agentId}`,
            agentId,
          };
          
          setEvaluationResult(result);
          setStep('complete');
        } catch (error) {
          console.error('Error running evaluation:', error);
          setEvaluationResult({
            totalTests: 0,
            passed: 0,
            failed: 0,
            duration: 'Failed',
            evaluationUrl: dashboardUrl || 'https://eval.rippletide.com',
          });
          setStep('complete');
        }
      })();
    }
  }, [step, agentEndpoint, knowledgeSource, pineconeQAndA]);

  const handleAgentEndpointSubmit = (value: string) => {
    setAgentEndpoint(value);
    setStep('checking-knowledge');
  };

  const handleSourceSelect = (value: string) => {
    setKnowledgeSource(value);
    if (value === 'pinecone') {
      setStep('pinecone-url');
    } else {
      setStep('running-evaluation');
    }
  };

  const handlePineconeUrlSubmit = (value: string) => {
    setPineconeUrl(value);
    setStep('pinecone-api-key');
  };

  const handlePineconeApiKeySubmit = (value: string) => {
    setPineconeApiKey(value);
    setStep('fetching-pinecone');
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Header />

      {step === 'agent-endpoint' && (
        <Box flexDirection="column">
          <TextInput
            label="Agent endpoint"
            placeholder="http://localhost:8000"
            onSubmit={handleAgentEndpointSubmit}
          />
        </Box>
      )}

      {step === 'checking-knowledge' && (
        <Box flexDirection="column">
          <Spinner label="Checking for knowledge base in current folder..." />
        </Box>
      )}

      {step === 'select-source' && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold color="#eba1b5">Choose your data source:</Text>
          </Box>
          {knowledgeFound && (
            <Box marginBottom={1}>
              <Text color="white">qanda.json found in current directory</Text>
            </Box>
          )}
          <SelectMenu
            title="Data Source"
            options={knowledgeSources}
            onSelect={handleSourceSelect}
          />
        </Box>
      )}

      {step === 'pinecone-url' && (
        <Box flexDirection="column">
          <TextInput
            label="Pinecone database URL"
            placeholder="https://sample-movies-02j22s8.svc.aped-4627-b74a.pinecone.io"
            onSubmit={handlePineconeUrlSubmit}
          />
        </Box>
      )}

      {step === 'pinecone-api-key' && (
        <Box flexDirection="column">
          <TextInput
            label="Pinecone API key"
            placeholder="pcsk_..."
            onSubmit={handlePineconeApiKeySubmit}
          />
        </Box>
      )}

      {step === 'fetching-pinecone' && (
        <Box flexDirection="column">
          <Spinner label={pineconeProgress || "Fetching Q&A from Pinecone..."} />
        </Box>
      )}

      {step === 'running-evaluation' && (
        <Box flexDirection="column">
          <Box marginBottom={2}>
            <Spinner label="Running evaluation" />
          </Box>
          
          <Box flexDirection="column" marginBottom={1}>
            <Box>
              <Box width={12}>
                <Text dimColor>Endpoint:</Text>
              </Box>
              <Text>{agentEndpoint || 'http://localhost:8000'}</Text>
            </Box>
            
            <Box>
              <Box width={12}>
                <Text dimColor>Data Source:</Text>
              </Box>
              <Text>{knowledgeSources.find(s => s.value === knowledgeSource)?.label || 'None'}</Text>
            </Box>
          </Box>

          <ProgressBar 
            progress={evaluationProgress}
          />
          
          {currentQuestion && (
            <Box flexDirection="column" marginTop={1} marginBottom={1}>
              <Box>
                <Text bold color="#eba1b5">Current Question:</Text>
              </Box>
              <Box paddingLeft={2}>
                <Text color="white">{currentQuestion}</Text>
              </Box>
            </Box>
          )}
          
          {currentLLMResponse && (
            <Box flexDirection="column" marginTop={1}>
              <Box>
                <Text bold color="green">LLM Response:</Text>
              </Box>
              <Box paddingLeft={2}>
                <Text>{currentLLMResponse.length > 200 ? currentLLMResponse.substring(0, 200) + '...' : currentLLMResponse}</Text>
              </Box>
            </Box>
          )}
        </Box>
      )}

      {step === 'complete' && evaluationResult && (
        <Box flexDirection="column">
          <Summary
            totalTests={evaluationResult.totalTests}
            passed={evaluationResult.passed}
            failed={evaluationResult.failed}
            duration={evaluationResult.duration}
            evaluationUrl={evaluationResult.evaluationUrl}
          />
        </Box>
      )}
    </Box>
  );
};
