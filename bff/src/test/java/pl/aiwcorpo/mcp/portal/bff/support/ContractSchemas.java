package pl.aiwcorpo.mcp.portal.bff.support;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Locale;

import com.networknt.schema.Error;
import com.networknt.schema.Schema;
import com.networknt.schema.SchemaLocation;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SchemaRegistryConfig;
import com.networknt.schema.SpecificationVersion;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;
import tools.jackson.dataformat.yaml.YAMLMapper;

/**
 * Validates BFF answers against C12 ({@code portal-bff.v1.bundled.yaml} from the mcp-contracts jar) and other
 * contract schemas. A status the contract does not list for the operation fails the check.
 */
public final class ContractSchemas {

    public static final String PORTAL_BFF = "mcp-contracts/openapi/bundled/portal-bff.v1.bundled.yaml";
    public static final String CREDENTIAL_BROKER = "mcp-contracts/openapi/bundled/credential-broker.v1.bundled.yaml";
    public static final String GATEWAY_ADMIN = "mcp-contracts/openapi/bundled/gateway-admin.v1.bundled.yaml";

    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final SchemaRegistry REGISTRY = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12,
            builder -> builder.schemaRegistryConfig(SchemaRegistryConfig.builder().formatAssertionsEnabled(true).build()));

    private final JsonNode document;

    private ContractSchemas(JsonNode document) {
        this.document = document;
    }

    public static ContractSchemas openApi(String classpathResource) {
        try (InputStream in = ContractSchemas.class.getClassLoader().getResourceAsStream(classpathResource)) {
            if (in == null) {
                throw new IllegalStateException("missing contract resource " + classpathResource);
            }
            return new ContractSchemas(new YAMLMapper().readTree(in));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** JSON Schema file of mcp-contracts, with its relative references resolved from the classpath. */
    public static Schema jsonSchema(String classpathResource) {
        return REGISTRY.getSchema(SchemaLocation.of("classpath:" + classpathResource));
    }

    public static void assertValid(Schema schema, JsonNode instance) {
        List<Error> errors = schema.validate(instance);
        assertThat(errors).as("schema errors for %s", instance).isEmpty();
    }

    /** Checks status, content type and body of a BFF response against the operation in the C12 contract. */
    public void assertResponse(String method, String pathTemplate, HttpResponse<String> response) {
        JsonNode operation = document.path("paths").path(pathTemplate).path(method.toLowerCase(Locale.ROOT));
        if (operation.isMissingNode()) {
            fail("operation %s %s is not in the contract", method, pathTemplate);
        }
        String status = Integer.toString(response.statusCode());
        JsonNode responseSpec = resolve(operation.path("responses").path(status));
        if (responseSpec.isMissingNode()) {
            fail("status %s of %s %s is not in the contract (body: %s)", status, method, pathTemplate, response.body());
        }
        for (var header : responseSpec.path("headers").properties()) {
            if (header.getValue().path("required").asBoolean(false)) {
                assertThat(response.headers().firstValue(header.getKey()))
                        .as("required header %s", header.getKey()).isPresent();
            }
        }
        JsonNode content = responseSpec.path("content").path("application/json");
        if (content.isMissingNode()) {
            assertThat(response.body()).as("body of %s %s %s", method, pathTemplate, status).isEmpty();
            return;
        }
        assertThat(response.headers().firstValue("Content-Type").orElse(""))
                .as("content type").startsWith("application/json");
        assertValid(schemaAt(content.path("schema")), JSON.readTree(response.body()));
    }

    /**
     * Checks a request the BFF sent to C4/C5: the operation exists in the contract for this method and path, and
     * a JSON body (required or present) matches the request schema.
     */
    public void assertRequest(String method, String path, String body) {
        JsonNode operation = null;
        for (var entry : document.path("paths").properties()) {
            String pattern = entry.getKey().replaceAll("\\{[^}]+}", "[^/]+");
            if (path.matches(pattern)) {
                operation = entry.getValue().path(method.toLowerCase(Locale.ROOT));
                break;
            }
        }
        if (operation == null || operation.isMissingNode()) {
            fail("request %s %s is not an operation of the contract", method, path);
            return;
        }
        JsonNode requestBody = resolve(operation.path("requestBody"));
        boolean hasBody = body != null && !body.isEmpty();
        if (requestBody.isMissingNode()) {
            assertThat(hasBody).as("body of %s %s", method, path).isFalse();
            return;
        }
        if (requestBody.path("required").asBoolean(false)) {
            assertThat(hasBody).as("required body of %s %s", method, path).isTrue();
        }
        if (hasBody) {
            assertValid(schemaAt(requestBody.path("content").path("application/json").path("schema")), JSON.readTree(body));
        }
    }

    /** Validates a JSON value against {@code #/components/schemas/<name>} of this document. */
    public void assertComponent(String name, JsonNode instance) {
        ObjectNode ref = JSON.createObjectNode();
        ref.put("$ref", "#/components/schemas/" + name);
        assertValid(schemaAt(ref), instance);
    }

    /** Example value from the contract, e.g. the {@code mixed} example of {@code GET /api/v1/catalog} 200. */
    public JsonNode responseExample(String method, String pathTemplate, int status, String example) {
        JsonNode responseSpec = resolve(document.path("paths").path(pathTemplate).path(method.toLowerCase(Locale.ROOT))
                .path("responses").path(Integer.toString(status)));
        return responseSpec.path("content").path("application/json").path("examples").path(example).path("value");
    }

    private Schema schemaAt(JsonNode schemaNode) {
        ObjectNode root = JSON.createObjectNode();
        root.put("$schema", "https://json-schema.org/draft/2020-12/schema");
        if (schemaNode.isObject()) {
            root.setAll((ObjectNode) schemaNode.deepCopy());
        }
        // References are document-local (#/components/...), so the components travel with every schema.
        root.set("components", document.path("components").deepCopy());
        return REGISTRY.getSchema(root);
    }

    private JsonNode resolve(JsonNode node) {
        JsonNode current = node;
        while (current.has("$ref")) {
            String pointer = current.get("$ref").asString();
            if (!pointer.startsWith("#")) {
                throw new IllegalStateException("non-local reference " + pointer);
            }
            current = document.at(pointer.substring(1));
        }
        return current;
    }
}
