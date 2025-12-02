import os
import uuid

from langchain_core.messages import SystemMessage, HumanMessage
from langchain_openai import AzureChatOpenAI

RIPPLETIDE_API_KEY = os.environ["RIPPLETIDE_API_KEY"]  # This API key is given to developer by Rippletide

rippletide_agent_uuid = "..."  # FILL WITH AGENT CREATED PREVIOUSLY

rippletide_conversation_uuid = uuid.uuid4()  # creates a new conversation

rippletide_llm_model = AzureChatOpenAI(
    model="v1",
    api_key=RIPPLETIDE_API_KEY,
    azure_endpoint="https://agent.rippletide.com",
    azure_deployment="v1",
    api_version="2024-12-01-preview",
    openai_api_type="azure",
    default_headers={
        "x-rippletide-agent-id": rippletide_agent_uuid,
        "x-rippletide-conversation-id": rippletide_conversation_uuid,
    },
)

messages = [SystemMessage(content="You are a helpful assistant."), HumanMessage(content="Hello.")]

response = rippletide_llm_model.invoke(messages)
print(response.content)
