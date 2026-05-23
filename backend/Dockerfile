FROM golang:1.23-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/api ./cmd/api
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/import-history ./cmd/import-history

FROM alpine:3.20

WORKDIR /app
RUN apk add --no-cache ca-certificates && adduser -D -H appuser
COPY --from=builder /out/api /app/api
COPY --from=builder /out/import-history /app/import-history

EXPOSE 8080
USER appuser
CMD ["/app/api"]
