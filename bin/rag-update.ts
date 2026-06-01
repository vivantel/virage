#!/usr/bin/env node

import { Command } from 'commander';
import { config } from 'dotenv';
import { loadConfig, autoDetectConfig } from '../src/config-loader.js';
import { Orchestrator } from '../src/core/orchestrator.js';

config();

const program = new Command();

program
  .name('rag-update')
  .description('Update RAG index with latest changes')
  .version('1.0.0')
  .option('-c, --config <path>', 'Path to config file (auto-detects rag.config.json then rag.config.ts)', autoDetectConfig())
  .option('-f, --force', 'Force full rebuild', false)
  .option('--skip-upload', 'Skip upload to vector store', false)
  .option('--chunks-file <path>', 'Output path for chunks.json')
  .option('--embeddings-file <path>', 'Output path for embeddings.json')
  .parse();

async function main() {
  const options = program.opts();
  
  console.log('🚀 RAG Update Tool\n');
  
  try {
    const config = await loadConfig(options.config);
    
    const orchestrator = new Orchestrator({
      ...config,
      options: {
        ...config.options,
        force: options.force || config.options?.force,
        skipUpload: options.skipUpload || config.options?.skipUpload,
        chunksFile: options.chunksFile || config.options?.chunksFile,
        embeddingsFile: options.embeddingsFile || config.options?.embeddingsFile
      }
    });
    
    await orchestrator.run();
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();