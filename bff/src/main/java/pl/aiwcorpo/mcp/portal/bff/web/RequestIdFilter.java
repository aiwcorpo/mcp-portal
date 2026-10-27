package pl.aiwcorpo.mcp.portal.bff.web;

import java.io.IOException;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Gives every request its own id; an id sent by the browser is ignored because it is not trusted for audit. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestIdFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String id = RequestIds.newId();
        request.setAttribute(RequestIds.ATTRIBUTE, id);
        response.setHeader(RequestIds.HEADER, id);
        chain.doFilter(request, response);
    }
}
