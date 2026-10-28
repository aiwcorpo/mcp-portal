package pl.aiwcorpo.mcp.portal.bff.web;

import tools.jackson.databind.cfg.CoercionAction;
import tools.jackson.databind.cfg.CoercionInputShape;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.type.LogicalType;

/**
 * Mapper for bodies of C12 requests: a value has the JSON type the schema names. Jackson would otherwise turn
 * {@code 123456} into the string {@code "123456"} (and {@code "1"} into a number), so the type check of the contract
 * would silently not apply.
 */
public final class StrictJson {

    private StrictJson() {
    }

    public static JsonMapper.Builder builder() {
        return JsonMapper.builder()
                .withCoercionConfig(LogicalType.Textual, config -> config
                        .setCoercion(CoercionInputShape.Integer, CoercionAction.Fail)
                        .setCoercion(CoercionInputShape.Float, CoercionAction.Fail)
                        .setCoercion(CoercionInputShape.Boolean, CoercionAction.Fail))
                .withCoercionConfig(LogicalType.Integer, config -> config
                        .setCoercion(CoercionInputShape.String, CoercionAction.Fail)
                        .setCoercion(CoercionInputShape.Boolean, CoercionAction.Fail))
                .withCoercionConfig(LogicalType.Boolean, config -> config
                        .setCoercion(CoercionInputShape.String, CoercionAction.Fail)
                        .setCoercion(CoercionInputShape.Integer, CoercionAction.Fail));
    }
}
