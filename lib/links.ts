import type { Tier, Workload } from './types';

export interface Link {
  title: string;
  href: string;
}

/**
 * Every outbound URL, in one place.
 *
 * House rule, see AGENTS.md: verify a link is live before adding it. Dead links
 * on a paid campaign landing page are expensive.
 */
export const LINKS = {
  embedded: {
    title: 'Comparing embedded vector databases',
    href: 'https://www.actian.com/blog/developer/comparing-embedded-vector-databases/',
  },
  pyLibs: {
    title: '5 best Python vector database libraries',
    href: 'https://www.actian.com/blog/developer/5-best-python-vector-database-libraries/',
  },
  pgAlt: {
    title: 'Is VectorAI DB the best embedded pgvector alternative?',
    href: 'https://www.actian.com/blog/developer/is-actian-vectorai-db-the-best-embedded-pgvector-alternative/',
  },
  state: {
    title: 'State of Vector Databases Q2 2026',
    href: 'https://www.actian.com/blog/developer/state-of-vector-databases-q2-2026/',
  },
  memArch: {
    title: 'What you need to know about AI agent memory architecture',
    href: 'https://dev.to/actiandev/what-you-need-to-know-about-ai-agent-memory-architecture-49ek',
  },
  pydantic: {
    title: 'Add persistent memory to a Pydantic AI agent',
    href: 'https://www.actian.com/blog/developer/add-persistent-memory-to-a-pydantic-ai-agent-with-vectorai-db/',
  },
  crewai: {
    title: 'Replace CrewAI memory in production',
    href: 'https://www.actian.com/blog/developer/replace-crewai-memory-in-production-with-vectorai-db/',
  },
  selfImproving: {
    title: 'Build a self-improving coding agent with codebase memory',
    href: 'https://www.actian.com/blog/developer/build-a-self-improving-gpt-6-astra-coding-agent-with-codebase-memory/',
  },
  pinecone: {
    title: 'On-premises Pinecone alternative',
    href: 'https://www.actian.com/blog/developer/is-actian-vectorai-db-the-best-on-premises-pinecone-alternative/',
  },
  qdrantAir: {
    title: 'Air-gapped Qdrant alternative',
    href: 'https://www.actian.com/blog/developer/is-vectorai-db-the-best-air-gapped-qdrant-alternative/',
  },
  weaviateEdge: {
    title: 'Weaviate alternative for edge devices',
    href: 'https://www.actian.com/blog/developer/weviate-alternatives-is-vectorai-db-the-best-choice-for-edge-devices/',
  },
  milvus: {
    title: 'Lightweight Milvus alternative',
    href: 'https://www.actian.com/blog/developer/is-actian-vectorai-db-the-best-lightweight-milvus-alternative/',
  },
  chroma: {
    title: 'Production ChromaDB alternative',
    href: 'https://www.actian.com/blog/developer/is-actian-vectorai-db-the-best-production-chromadb-alternative/',
  },
  langchain: {
    title: 'LangChain with VectorAI DB for on-prem RAG',
    href: 'https://www.actian.com/blog/developer/how-to-set-up-langchain-with-vectorai-db-for-on-prem-rag/',
  },
  fastapi: {
    title: 'Add vector search to your FastAPI app',
    href: 'https://www.actian.com/blog/developer/add-vector-search-to-your-fastapi-app-with-vectorai-db/',
  },
  qdrantMigrate: {
    title: 'Migrate from Qdrant to VectorAI DB',
    href: 'https://www.actian.com/blog/developer/how-to-migrate-from-qdrant-to-actian-vectorai-db/',
  },
  quantization: {
    title: 'Which quantization level for edge LLM deployment?',
    href: 'https://www.actian.com/blog/developer/which-quantization-level-should-you-use-for-edge-llm-deployment/',
  },
  raspberryPi: {
    title: 'Best LLM for Raspberry Pi 5',
    href: 'https://www.actian.com/blog/developer/phi-4-mini-vs-gemma-4-vs-qwen3-best-llm-for-raspberry-pi-5/',
  },
  hipaa: {
    title: 'Build a HIPAA-compliant AI ecosystem without the cloud',
    href: 'https://www.actian.com/blog/developer/how-to-build-a-hipaa-compliant-ai-ecosystem-without-the-cloud/',
  },
  fintech: {
    title: 'Build a compliance document search system for fintech',
    href: 'https://www.actian.com/blog/developer/how-to-build-a-compliance-document-search-system-for-fintech/',
  },
  community: {
    title: 'VectorAI DB Community Edition',
    href: 'https://www.actian.com/databases/vectorai-db/community-edition/',
  },
  product: {
    title: 'VectorAI DB',
    href: 'https://www.actian.com/databases/vectorai-db/',
  },
  demo: {
    title: 'Book a demo',
    href: 'https://www.actian.com/databases/vectorai-db/demo/',
  },
  github: {
    title: 'Actian for Developers',
    href: 'https://github.com/actian-devs',
  },
} as const satisfies Record<string, Link>;

export type LinkKey = keyof typeof LINKS;

/** Reading list for a verdict, capped at five and de-duplicated. */
export function readsFor(tier: Tier, w: Workload): Link[] {
  const picked: Link[] = [];

  if (tier === 0) {
    picked.push(LINKS.embedded, LINKS.pyLibs, LINKS.memArch, LINKS.state);
  } else if (tier === 1) {
    picked.push(LINKS.embedded, LINKS.memArch, LINKS.state);
  } else if (tier === 2) {
    picked.push(LINKS.pgAlt, LINKS.state, LINKS.langchain, LINKS.memArch, LINKS.embedded);
  } else {
    picked.push(LINKS.memArch);
    if (w.residency === 'edge') {
      picked.push(LINKS.weaviateEdge, LINKS.quantization, LINKS.raspberryPi);
    }
    if (w.residency === 'airgapped') picked.push(LINKS.qdrantAir, LINKS.hipaa);
    if (w.residency === 'onprem') picked.push(LINKS.pinecone, LINKS.fintech);
    if (w.tenancy === 'many' || w.changeRate === 'constant') picked.push(LINKS.crewai);
    if (w.filtering !== 'never') picked.push(LINKS.chroma);
    picked.push(
      LINKS.pydantic,
      LINKS.langchain,
      LINKS.qdrantMigrate,
      LINKS.milvus,
      LINKS.selfImproving,
      LINKS.fastapi,
    );
  }

  const seen = new Set<string>();
  return picked
    .filter((l) => {
      if (seen.has(l.href)) return false;
      seen.add(l.href);
      return true;
    })
    .slice(0, 5);
}

export const UTM_SOURCE = 'vector-db-calculator';
export const UTM_MEDIUM = 'hub';

/**
 * Campaign is inherited from the page's own utm_campaign so traffic from a
 * given newsletter stays attributable all the way through to the product page.
 */
export function readCampaign(search: string): string {
  try {
    const value = new URLSearchParams(search).get('utm_campaign');
    return value && /^[\w.-]{1,64}$/.test(value) ? value : 'organic';
  } catch {
    return 'organic';
  }
}

export function withUtm(href: string, campaign: string, content?: string): string {
  try {
    const url = new URL(href);
    url.searchParams.set('utm_source', UTM_SOURCE);
    url.searchParams.set('utm_medium', UTM_MEDIUM);
    url.searchParams.set('utm_campaign', campaign);
    if (content) url.searchParams.set('utm_content', content);
    return url.toString();
  } catch {
    return href;
  }
}
