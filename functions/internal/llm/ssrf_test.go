package llm

import (
	"context"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
)

func TestBlockedIP(t *testing.T) {
	blocked := []string{"127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "fc00::1", "::1"}
	for _, raw := range blocked {
		if !blockedIP(net.ParseIP(raw)) {
			t.Fatalf("%s was not blocked", raw)
		}
	}
	if blockedIP(net.ParseIP("8.8.8.8")) {
		t.Fatal("public IPv4 was blocked")
	}
}

func TestVisibleTextStripsHTML(t *testing.T) {
	text := visibleText(`<html><head><style>.x{}</style><script>alert(1)</script></head><body><h1>Hello</h1><p>World</p></body></html>`)
	if strings.Contains(text, "alert") || strings.Contains(text, ".x") {
		t.Fatalf("hidden text leaked: %q", text)
	}
	if text != "Hello World" {
		t.Fatalf("text = %q", text)
	}
}

func TestFetchURLRejectsNonHTTPS(t *testing.T) {
	if _, err := FetchURL(context.Background(), "http://example.com"); err == nil {
		t.Fatal("FetchURL accepted http URL")
	}
}

func TestSafeResolveBlocksAnyPrivateAddress(t *testing.T) {
	_, err := safeResolve(context.Background(), fakeResolver{
		ips: []net.IP{net.ParseIP("8.8.8.8"), net.ParseIP("10.0.0.1")},
	}, "example.test")
	if err == nil {
		t.Fatal("safeResolve accepted mixed public/private results")
	}
}

func TestFetchURLFollowsRedirectAndEnforcesLimit(t *testing.T) {
	fetcher := NewFetcher()
	fetcher.Resolver = fakeResolver{ips: []net.IP{net.ParseIP("8.8.8.8")}}
	redirects := 0
	fetcher.Client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if redirects < 1 {
			redirects++
			return textResponse(r, http.StatusFound, "text/plain", "", "https://example.test/next"), nil
		}
		return textResponse(r, http.StatusOK, "text/plain", "done", ""), nil
	})

	text, err := fetcher.FetchURL(context.Background(), "https://example.test/start")
	if err != nil {
		t.Fatalf("FetchURL: %v", err)
	}
	if text != "done" {
		t.Fatalf("text = %q", text)
	}

	fetcher = NewFetcher()
	fetcher.Resolver = fakeResolver{ips: []net.IP{net.ParseIP("8.8.8.8")}}
	fetcher.Client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return textResponse(r, http.StatusFound, "text/plain", "", "https://example.test/again"), nil
	})
	if _, err := fetcher.FetchURL(context.Background(), "https://example.test/start"); err == nil {
		t.Fatal("FetchURL accepted too many redirects")
	}
}

func TestFetchURLRejectsOversizedAndUnsupportedContent(t *testing.T) {
	fetcher := NewFetcher()
	fetcher.Resolver = fakeResolver{ips: []net.IP{net.ParseIP("8.8.8.8")}}
	fetcher.Client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return textResponse(r, http.StatusOK, "text/plain", strings.Repeat("x", maxFetchBytes+1), ""), nil
	})
	if _, err := fetcher.FetchURL(context.Background(), "https://example.test/large"); err == nil {
		t.Fatal("FetchURL accepted oversized response")
	}

	fetcher.Client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return textResponse(r, http.StatusOK, "application/json", `{}`, ""), nil
	})
	if _, err := fetcher.FetchURL(context.Background(), "https://example.test/json"); err == nil {
		t.Fatal("FetchURL accepted unsupported content type")
	}
}

type fakeResolver struct {
	ips []net.IP
}

func (f fakeResolver) LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error) {
	out := make([]net.IPAddr, 0, len(f.ips))
	for _, ip := range f.ips {
		out = append(out, net.IPAddr{IP: ip})
	}
	return out, nil
}

func textResponse(req *http.Request, status int, contentType string, body string, location string) *http.Response {
	header := make(http.Header)
	header.Set("Content-Type", contentType)
	if location != "" {
		header.Set("Location", location)
	}
	return &http.Response{
		StatusCode: status,
		Header:     header,
		Body:       io.NopCloser(strings.NewReader(body)),
		Request:    req,
	}
}
