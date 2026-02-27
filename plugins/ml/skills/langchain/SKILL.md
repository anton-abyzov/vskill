---
description: "LCEL chain composition patterns, LangGraph stateful agent workflows, v0.1 deprecation warnings, and structured output parsing."
model: opus
context: fork
---

# LangChain & AI Agent Frameworks

## CRITICAL: v0.1 Deprecation Warnings

The following LangChain v0.1 patterns are **DEPRECATED** and must NOT be used:

| Deprecated (v0.1) | Replacement (v0.2+) |
|---|---|
| `LLMChain` | LCEL: `prompt \| model \| parser` |
| `SequentialChain` | LCEL: `chain1 \| chain2 \| chain3` |
| `SimpleSequentialChain` | LCEL pipeline |
| `TransformChain` | `RunnableLambda` |
| `ConversationChain` | LCEL with `MessagesPlaceholder` |
| `load_qa_chain` | LCEL with retriever |
| `RetrievalQA` | LCEL: `retriever \| prompt \| model` |
| `AgentExecutor` (legacy) | `create_tool_calling_agent` or LangGraph |

## LCEL (LangChain Expression Language)

### Basic Chain Composition

```python
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_openai import ChatOpenAI

prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a helpful assistant specialized in {domain}."),
    ("human", "{question}")
])

model = ChatOpenAI(model="gpt-4o", temperature=0)
parser = StrOutputParser()

chain = prompt | model | parser

result = chain.invoke({"domain": "Python", "question": "Explain decorators"})
result = await chain.ainvoke({"domain": "Python", "question": "Explain decorators"})
results = chain.batch([...], config={"max_concurrency": 5})
```

### Parallel and Branching

```python
from langchain_core.runnables import RunnableParallel, RunnablePassthrough

parallel_chain = RunnableParallel(
    summary=summary_chain,
    keywords=keyword_chain,
    sentiment=sentiment_chain,
)
result = parallel_chain.invoke({"text": document})
# {"summary": "...", "keywords": [...], "sentiment": "positive"}

# Passthrough for forwarding input alongside transformations
chain = RunnableParallel(
    context=retriever,
    question=RunnablePassthrough(),
) | prompt | model | parser
```

### Fallbacks

```python
primary = ChatOpenAI(model="gpt-4o", temperature=0)
fallback = ChatOpenAI(model="gpt-4o-mini", temperature=0)

robust_model = primary.with_fallbacks([fallback])
chain = prompt | robust_model | parser
```

### Routing

```python
from langchain_core.runnables import RunnableLambda

def route_by_topic(input_dict: dict) -> Runnable:
    topic = input_dict.get("topic", "general")
    if topic == "technical":
        return technical_chain
    elif topic == "creative":
        return creative_chain
    return general_chain

routed_chain = RunnableLambda(route_by_topic)
```

### Structured Output (Pydantic)

```python
from pydantic import BaseModel, Field

class ProductReview(BaseModel):
    sentiment: str = Field(description="positive, negative, or neutral")
    confidence: float = Field(ge=0.0, le=1.0)
    key_points: list[str] = Field(description="Main points from the review")

# Preferred: uses tool calling under the hood
structured_llm = llm.with_structured_output(ProductReview)
result: ProductReview = structured_llm.invoke("Review: This laptop is amazing...")
```

## LangGraph Stateful Agents

### Basic Graph

```python
from langgraph.graph import StateGraph, END
from typing import TypedDict, Annotated
import operator

class AgentState(TypedDict):
    messages: Annotated[list, operator.add]
    next_step: str
    iteration: int

def researcher(state: AgentState) -> dict:
    response = research_chain.invoke({"messages": state["messages"]})
    return {
        "messages": [response],
        "next_step": "analyzer",
        "iteration": state["iteration"] + 1,
    }

def analyzer(state: AgentState) -> dict:
    response = analysis_chain.invoke({"messages": state["messages"]})
    return {"messages": [response], "next_step": "writer"}

def writer(state: AgentState) -> dict:
    response = writing_chain.invoke({"messages": state["messages"]})
    return {"messages": [response], "next_step": "end"}

def should_continue(state: AgentState) -> str:
    if state["iteration"] > 3:
        return "writer"
    return state["next_step"]

graph = StateGraph(AgentState)
graph.add_node("researcher", researcher)
graph.add_node("analyzer", analyzer)
graph.add_node("writer", writer)

graph.set_entry_point("researcher")
graph.add_conditional_edges("researcher", should_continue)
graph.add_edge("analyzer", "researcher")
graph.add_edge("writer", END)

app = graph.compile()
result = app.invoke({
    "messages": ["Research the impact of AI on healthcare"],
    "next_step": "researcher",
    "iteration": 0,
})
```

### Human-in-the-Loop

```python
from langgraph.checkpoint.memory import MemorySaver

checkpointer = MemorySaver()

app = graph.compile(
    checkpointer=checkpointer,
    interrupt_before=["critical_action"],
)

config = {"configurable": {"thread_id": "user-123"}}
result = app.invoke(initial_state, config)
# Pauses at "critical_action"

# After human approval, resume
result = app.invoke(None, config)
```

### Streaming Events

```python
async for event in chain.astream_events(
    {"question": "Explain quantum computing"},
    version="v2",
):
    if event["event"] == "on_chat_model_stream":
        print(event["data"]["chunk"].content, end="")
    elif event["event"] == "on_tool_start":
        print(f"\nUsing tool: {event['name']}")
```

### Token Trimming for Long Conversations

```python
from langchain_core.messages import trim_messages

trimmed = trim_messages(
    messages,
    max_tokens=4000,
    strategy="last",
    token_counter=ChatOpenAI(model="gpt-4o"),
    include_system=True,
)
```
