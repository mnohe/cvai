package observability

import (
	"context"
	"errors"
	"log"
	"os"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	"go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

const (
	defaultServiceName     = "cvai-api"
	defaultMetricInterval  = 30 * time.Second
	defaultShutdownTimeout = 5 * time.Second
	protocolHTTPProtobuf   = "http/protobuf"
	protocolGRPC           = "grpc"
	exporterOTLP           = "otlp"
	exporterNone           = "none"
	envOTLPEndpoint        = "OTEL_EXPORTER_OTLP_ENDPOINT"
	envOTLPProtocol        = "OTEL_EXPORTER_OTLP_PROTOCOL"
	envTraceEndpoint       = "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"
	envTraceProtocol       = "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL"
	envTraceExporter       = "OTEL_TRACES_EXPORTER"
	envMetricEndpoint      = "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"
	envMetricProtocol      = "OTEL_EXPORTER_OTLP_METRICS_PROTOCOL"
	envMetricExporter      = "OTEL_METRICS_EXPORTER"
	envServiceName         = "OTEL_SERVICE_NAME"
)

// Init configures vendor-neutral OpenTelemetry export from standard OTEL_* env vars.
// Without OTLP env configuration it leaves the global no-op providers in place.
func Init(ctx context.Context) (func(context.Context) error, error) {
	res := resource.NewWithAttributes(semconv.SchemaURL, semconv.ServiceName(serviceName()))
	shutdowns := make([]func(context.Context) error, 0, 2)

	if tracesEnabled() {
		tp, err := initTraces(ctx, res)
		if err != nil {
			return nil, err
		}
		otel.SetTracerProvider(tp)
		shutdowns = append(shutdowns, tp.Shutdown)
		log.Printf("otel_traces_enabled protocol=%s", signalProtocol(envTraceProtocol))
	}

	if metricsEnabled() {
		mp, err := initMetrics(ctx, res)
		if err != nil {
			return nil, err
		}
		otel.SetMeterProvider(mp)
		shutdowns = append(shutdowns, mp.Shutdown)
		log.Printf("otel_metrics_enabled protocol=%s", signalProtocol(envMetricProtocol))
	}

	if len(shutdowns) > 0 {
		otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
			propagation.TraceContext{},
			propagation.Baggage{},
		))
	}

	return func(ctx context.Context) error {
		if len(shutdowns) == 0 {
			return nil
		}
		if _, ok := ctx.Deadline(); !ok {
			var cancel context.CancelFunc
			ctx, cancel = context.WithTimeout(ctx, defaultShutdownTimeout)
			defer cancel()
		}
		errs := make([]error, 0, len(shutdowns))
		for _, shutdown := range shutdowns {
			if err := shutdown(ctx); err != nil {
				errs = append(errs, err)
			}
		}
		return errors.Join(errs...)
	}, nil
}

func initTraces(ctx context.Context, res *resource.Resource) (*trace.TracerProvider, error) {
	var exp trace.SpanExporter
	var err error
	switch signalProtocol(envTraceProtocol) {
	case protocolHTTPProtobuf:
		exp, err = otlptracehttp.New(ctx)
	default:
		exp, err = otlptracegrpc.New(ctx)
	}
	if err != nil {
		return nil, err
	}
	return trace.NewTracerProvider(trace.WithBatcher(exp), trace.WithResource(res)), nil
}

func initMetrics(ctx context.Context, res *resource.Resource) (*metric.MeterProvider, error) {
	var exp metric.Exporter
	var err error
	switch signalProtocol(envMetricProtocol) {
	case protocolHTTPProtobuf:
		exp, err = otlpmetrichttp.New(ctx)
	default:
		exp, err = otlpmetricgrpc.New(ctx)
	}
	if err != nil {
		return nil, err
	}
	reader := metric.NewPeriodicReader(exp, metric.WithInterval(defaultMetricInterval))
	return metric.NewMeterProvider(metric.WithReader(reader), metric.WithResource(res)), nil
}

func tracesEnabled() bool {
	return signalEnabled(envTraceExporter, envTraceEndpoint)
}

func metricsEnabled() bool {
	return signalEnabled(envMetricExporter, envMetricEndpoint)
}

func signalEnabled(exporterKey string, endpointKey string) bool {
	exporter := strings.TrimSpace(strings.ToLower(os.Getenv(exporterKey)))
	if exporter == exporterNone {
		return false
	}
	if exporterContains(exporter, exporterOTLP) {
		return true
	}
	return os.Getenv(endpointKey) != "" || os.Getenv(envOTLPEndpoint) != ""
}

func exporterContains(value string, want string) bool {
	for _, item := range strings.Split(value, ",") {
		if strings.TrimSpace(item) == want {
			return true
		}
	}
	return false
}

func signalProtocol(signalKey string) string {
	value := strings.TrimSpace(strings.ToLower(os.Getenv(signalKey)))
	if value == "" {
		value = strings.TrimSpace(strings.ToLower(os.Getenv(envOTLPProtocol)))
	}
	if value == protocolHTTPProtobuf {
		return protocolHTTPProtobuf
	}
	return protocolGRPC
}

func serviceName() string {
	if value := strings.TrimSpace(os.Getenv(envServiceName)); value != "" {
		return value
	}
	return defaultServiceName
}
