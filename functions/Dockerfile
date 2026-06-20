FROM golang:1.23-alpine AS builder
WORKDIR /app/functions
COPY functions/go.mod ./
RUN go mod download
COPY functions/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -o /cvai ./cmd/...

FROM alpine:3.20
RUN addgroup -S app && adduser -S -G app app
WORKDIR /app
COPY --from=builder /cvai .
COPY schemas/cv.schema.json /app/schemas/cv.schema.json
USER app
ENV PORT=8080
ENV CV_SCHEMA_PATH=/app/schemas/cv.schema.json
EXPOSE 8080
CMD ["./cvai"]
