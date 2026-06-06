import os

from fastmcp import FastMCP

mcp = FastMCP("pact-fixture-upstream-mcp")


@mcp.tool
def echo(message: str) -> dict:
    """Echo a message through the fixture upstream MCP service."""
    return {
        "echo": message,
        "service": "pact-fixture-upstream-mcp",
        "verified": True,
    }


@mcp.tool
def add(a: int, b: int) -> int:
    """Add two integers through the fixture upstream MCP service."""
    return a + b


if __name__ == "__main__":
    mcp.run(
        transport="http",
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "8787")),
        path="/mcp/",
        log_level="INFO",
    )
