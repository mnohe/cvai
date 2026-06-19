package llm

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/net/html"
)

const maxFetchBytes = 2 << 20

var errUnsafeURL = errors.New("unsafe url")

// FetchURL fetches visible text from an HTTPS URL using SSRF protections.
func FetchURL(ctx context.Context, rawURL string) (string, error) {
	return NewFetcher().FetchURL(ctx, rawURL)
}

// Fetcher fetches user-provided URLs while blocking private and metadata networks.
type Fetcher struct {
	Resolver resolver
	Client   *http.Client
}

type resolver interface {
	LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error)
}

// NewFetcher creates a protected URL fetcher.
func NewFetcher() *Fetcher {
	f := &Fetcher{Resolver: net.DefaultResolver}
	f.Client = &http.Client{
		Timeout: 15 * time.Second,
		Transport: &http.Transport{
			Proxy: nil,
			DialContext: func(ctx context.Context, network string, address string) (net.Conn, error) {
				host, port, err := net.SplitHostPort(address)
				if err != nil {
					return nil, err
				}
				ips, err := safeResolve(ctx, f.Resolver, host)
				if err != nil {
					return nil, err
				}
				dialer := &net.Dialer{Timeout: 10 * time.Second}
				return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
			},
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too many redirects")
			}
			return validateFetchURL(req.Context(), f.Resolver, req.URL)
		},
	}
	return f
}

// FetchURL fetches visible text from an HTTPS URL.
func (f *Fetcher) FetchURL(ctx context.Context, rawURL string) (string, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("%w: invalid url", errUnsafeURL)
	}
	if err := validateFetchURL(ctx, f.resolver(), parsed); err != nil {
		return "", err
	}
	client := f.Client
	if client == nil {
		client = NewFetcher().Client
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "text/html,text/plain")
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return "", fmt.Errorf("fetch status %d", resp.StatusCode)
	}
	contentType := strings.ToLower(resp.Header.Get("Content-Type"))
	if !strings.HasPrefix(contentType, "text/html") && !strings.HasPrefix(contentType, "text/plain") {
		return "", fmt.Errorf("%w: unsupported content type", errUnsafeURL)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxFetchBytes+1))
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}
	if len(body) > maxFetchBytes {
		return "", fmt.Errorf("response exceeds 2 MB limit")
	}
	if strings.HasPrefix(contentType, "text/plain") {
		return strings.TrimSpace(string(body)), nil
	}
	return strings.TrimSpace(visibleText(string(body))), nil
}

func (f *Fetcher) resolver() resolver {
	if f.Resolver != nil {
		return f.Resolver
	}
	return net.DefaultResolver
}

func validateFetchURL(ctx context.Context, r resolver, u *url.URL) error {
	if u.Scheme != "https" {
		return fmt.Errorf("%w: only https is allowed", errUnsafeURL)
	}
	if u.User != nil {
		return fmt.Errorf("%w: credentials are not allowed", errUnsafeURL)
	}
	if u.Hostname() == "" {
		return fmt.Errorf("%w: host is required", errUnsafeURL)
	}
	_, err := safeResolve(ctx, r, u.Hostname())
	return err
}

func safeResolve(ctx context.Context, r resolver, host string) ([]net.IP, error) {
	ips, err := r.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, fmt.Errorf("resolve host: %w", err)
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("%w: host has no addresses", errUnsafeURL)
	}
	out := make([]net.IP, 0, len(ips))
	for _, ipAddr := range ips {
		ip := ipAddr.IP
		if blockedIP(ip) {
			return nil, fmt.Errorf("%w: blocked address", errUnsafeURL)
		}
		out = append(out, ip)
	}
	return out, nil
}

func blockedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsPrivate() || ip.IsUnspecified() {
		return true
	}
	if ip.Equal(net.ParseIP("169.254.169.254")) {
		return true
	}
	return false
}

func visibleText(markup string) string {
	doc, err := html.Parse(strings.NewReader(markup))
	if err != nil {
		return ""
	}
	var parts []string
	var walk func(*html.Node, bool)
	walk = func(n *html.Node, hidden bool) {
		nextHidden := hidden || (n.Type == html.ElementNode && (n.Data == "script" || n.Data == "style" || n.Data == "noscript"))
		if n.Type == html.TextNode && !nextHidden {
			text := strings.TrimSpace(n.Data)
			if text != "" {
				parts = append(parts, text)
			}
		}
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			walk(child, nextHidden)
		}
	}
	walk(doc, false)
	return strings.Join(parts, " ")
}
