# Build stage
FROM golang:1.26-alpine AS builder

WORKDIR /app
RUN apk add --no-cache git

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o store-api ./cmd/store-api

# Final stage
FROM alpine:3.19

WORKDIR /app
RUN apk add --no-cache ca-certificates

# Non-root user for security
RUN addgroup -S app && adduser -S app -G app
USER app

COPY --from=builder /app/store-api .
COPY migrations ./migrations
COPY configs ./configs

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

CMD ["./store-api"]