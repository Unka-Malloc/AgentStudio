# RAG Service

This directory is an external service template. Pact discovers
`external-service.config.json`, connects to the configured HTTP endpoint, and
runs the declared health check through the generic external-service registry.

The Dockerfile starts a small HTTP proxy container. Set `RAG_BACKEND_URL` to an
existing RAG backend if this container should forward traffic; without a backend
it still exposes `/health` for platform discovery and operations checks.
