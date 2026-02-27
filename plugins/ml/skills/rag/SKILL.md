---
description: "Chunking strategy comparison, vector database selection guide, retrieval optimization patterns (HyDE, multi-query, contextual compression, reranking)."
model: opus
context: fork
---

# RAG & Vector Database Systems

## Chunking Strategy Comparison

### Recursive Character (Recommended Default)

```python
from langchain_text_splitters import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=200,
    separators=["\n\n", "\n", ". ", " ", ""],
)
```

### Semantic Chunking (Meaning-Based Splits)

```python
from langchain_experimental.text_splitter import SemanticChunker
from langchain_openai import OpenAIEmbeddings

splitter = SemanticChunker(
    OpenAIEmbeddings(model="text-embedding-3-small"),
    breakpoint_threshold_type="percentile",
    breakpoint_threshold_amount=95,
)
```

### Parent-Child / Document-Structure-Aware

```python
from langchain_text_splitters import MarkdownHeaderTextSplitter

md_splitter = MarkdownHeaderTextSplitter(
    headers_to_split_on=[
        ("#", "h1"),
        ("##", "h2"),
        ("###", "h3"),
    ]
)
# Each chunk has metadata: {"h1": "Introduction", "h2": "Overview"}
```

### Chunking Decision Framework

| Content Type | Strategy | Chunk Size | Overlap |
|-------------|----------|------------|---------|
| General text | Recursive character | 800-1200 | 150-200 |
| Technical docs | Markdown header | By section | 0 (section-based) |
| Code | Language-aware | 500-1000 | 50-100 |
| Legal/medical | Semantic | Dynamic | N/A |
| Chat logs | Fixed by turn | 1 message | Include previous turn |
| Tables/CSV | Row-based | 20-50 rows | 2-5 rows |

## Vector Database Selection Guide

| DB | Best For | Hosting | Filtering | Scale |
|----|----------|---------|-----------|-------|
| Pinecone | Managed production | Cloud-only | Metadata | Billions |
| Qdrant | Self-hosted + cloud | Both | Rich payload | Millions-Billions |
| pgvector | Existing PostgreSQL | Self-hosted | SQL | Millions |
| ChromaDB | Development/prototyping | Local | Basic | Thousands-Millions |
| Weaviate | Hybrid search + modules | Both | GraphQL-like | Millions-Billions |
| Milvus | High-performance at scale | Both | Expression | Billions+ |

### Pinecone with Metadata Filtering

```python
from langchain_pinecone import PineconeVectorStore

vectorstore = PineconeVectorStore.from_documents(
    documents=chunks, embedding=embeddings,
    index_name="my-index", namespace="production",
)

retriever = vectorstore.as_retriever(
    search_kwargs={
        "k": 5,
        "filter": {"category": "technical", "year": {"$gte": 2024}},
    }
)
```

### Qdrant with Rich Filtering

```python
from langchain_qdrant import QdrantVectorStore
from qdrant_client.models import Filter, FieldCondition, MatchValue, Range

retriever = vectorstore.as_retriever(
    search_kwargs={
        "k": 5,
        "filter": Filter(
            must=[
                FieldCondition(key="metadata.source", match=MatchValue(value="docs")),
                FieldCondition(key="metadata.date", range=Range(gte="2024-01-01")),
            ]
        ),
    }
)
```

### pgvector (Use Existing PostgreSQL)

```python
from langchain_postgres import PGVector

vectorstore = PGVector.from_documents(
    documents=chunks, embedding=embeddings,
    collection_name="my_collection",
    connection="postgresql+psycopg://user:pass@localhost:5432/vectordb",
    use_jsonb=True,
)
# Benefits: ACID transactions, joins with relational data
```

## Retrieval Optimization Patterns

### HyDE (Hypothetical Document Embeddings)

Generate a hypothetical answer, embed that instead of the query for better semantic match.

```python
from langchain.chains import HypotheticalDocumentEmbedder

hyde_embeddings = HypotheticalDocumentEmbedder.from_llm(
    llm=ChatOpenAI(model="gpt-4o-mini", temperature=0.5),
    base_embeddings=OpenAIEmbeddings(model="text-embedding-3-small"),
    prompt_key="web_search",
)

vectorstore = Chroma(embedding_function=hyde_embeddings)
```

### Multi-Query Retrieval

Generates query variations and deduplicates results for better recall.

```python
from langchain.retrievers.multi_query import MultiQueryRetriever

multi_retriever = MultiQueryRetriever.from_llm(
    retriever=vectorstore.as_retriever(search_kwargs={"k": 5}),
    llm=ChatOpenAI(model="gpt-4o-mini", temperature=0.3),
)
# Automatically generates 3 query variations
```

### Contextual Compression with Reranking

```python
from langchain.retrievers import ContextualCompressionRetriever
from langchain_cohere import CohereRerank

reranker = CohereRerank(model="rerank-v3.5", top_n=5)

reranking_retriever = ContextualCompressionRetriever(
    base_compressor=reranker,
    base_retriever=vectorstore.as_retriever(search_kwargs={"k": 20}),
)

# Local alternative (no API needed)
from langchain_community.cross_encoders import HuggingFaceCrossEncoder
from langchain.retrievers.document_compressors import CrossEncoderReranker

cross_encoder = HuggingFaceCrossEncoder(model_name="cross-encoder/ms-marco-MiniLM-L-6-v2")
compressor = CrossEncoderReranker(model=cross_encoder, top_n=5)
```

### Maximum Marginal Relevance (MMR)

Balances relevance with diversity to avoid redundant results.

```python
retriever = vectorstore.as_retriever(
    search_type="mmr",
    search_kwargs={
        "k": 5,
        "fetch_k": 20,
        "lambda_mult": 0.7,  # 0 = max diversity, 1 = max relevance
    },
)
```

### Hybrid RAG (Dense + Sparse)

```python
from langchain_community.retrievers import BM25Retriever
from langchain.retrievers import EnsembleRetriever

dense_retriever = vectorstore.as_retriever(search_kwargs={"k": 10})
bm25_retriever = BM25Retriever.from_documents(documents, k=10)

hybrid_retriever = EnsembleRetriever(
    retrievers=[dense_retriever, bm25_retriever],
    weights=[0.6, 0.4],  # Favor semantic but include keyword matches
)
```

## Embedding Cache (Save API Costs)

```python
from langchain.storage import LocalFileStore
from langchain.embeddings import CacheBackedEmbeddings

cached_embeddings = CacheBackedEmbeddings.from_bytes_store(
    underlying_embeddings=OpenAIEmbeddings(model="text-embedding-3-small"),
    document_embedding_cache=LocalFileStore("./embedding_cache/"),
    namespace="text-embedding-3-small",
)
```

## RAG Pipeline Decision Framework

| Question | If Yes | If No |
|----------|--------|-------|
| Data changes frequently? | Incremental indexing | One-time batch index |
| Need precise keyword match? | Hybrid (dense + BM25) | Dense only |
| Results seem redundant? | MMR retrieval | Standard similarity |
| Quality not good enough? | Add reranking step | Check chunking first |
| Users ask complex questions? | Multi-query + step-back | Direct retrieval |
| Need metadata filtering? | Self-query or explicit filters | Standard semantic |
| Budget constrained? | Local embeddings + ChromaDB | Hosted solutions |
| Millions of documents? | Pinecone/Qdrant/Milvus | pgvector/ChromaDB |
