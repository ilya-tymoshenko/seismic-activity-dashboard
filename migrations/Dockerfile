FROM golang:1.23-alpine AS builder

RUN go install github.com/pressly/goose/v3/cmd/goose@v3.24.2

FROM alpine:3.20

RUN apk add --no-cache ca-certificates
COPY --from=builder /go/bin/goose /usr/local/bin/goose

ENTRYPOINT ["goose"]
