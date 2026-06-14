ARG NODE_BASE_IMAGE=node:24-bookworm-slim
FROM ${NODE_BASE_IMAGE}

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8788
ENV RAG_BACKEND_URL=

RUN mkdir -p /var/empty \
  && groupadd --system pactrag \
  && useradd --system --gid pactrag --home-dir /var/empty --no-create-home --shell /usr/sbin/nologin pactrag

WORKDIR /app
COPY external-service.config.json /app/external-service.config.json

EXPOSE 8788

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8788) + '/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

USER pactrag

CMD ["node", "-e", "const http=require('node:http');const port=Number(process.env.PORT||8788);const host=process.env.HOST||'0.0.0.0';const backend=(process.env.RAG_BACKEND_URL||'').replace(/\\/+$/,'');const json=(res,status,payload)=>{const body=JSON.stringify(payload);res.writeHead(status,{'content-type':'application/json','content-length':Buffer.byteLength(body)});res.end(body)};const proxy=(req,res)=>{if(!backend){json(res,501,{ok:false,error:'RAG_BACKEND_URL is not configured'});return}const target=new URL(req.url,backend);const upstream=http.request(target,{method:req.method,headers:req.headers},(r)=>{res.writeHead(r.statusCode||502,r.headers);r.pipe(res)});upstream.on('error',(error)=>json(res,502,{ok:false,error:error.message}));req.pipe(upstream)};http.createServer((req,res)=>{if(req.url==='/health'||req.url==='/healthz'){json(res,200,{ok:true,service:'external.knowledge.rag',backendConfigured:Boolean(backend)});return}proxy(req,res)}).listen(port,host);"]
