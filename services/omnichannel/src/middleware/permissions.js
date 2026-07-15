const { forbidden } = require("../utils/errors");

function requirePermission(permission) {
  return (req, _res, next) => {
    if (!req.user?.permissions?.includes(permission)) return next(forbidden("Permission denied"));
    next();
  };
}

function requireAnyPermission(permissions = []) {
  return (req, _res, next) => {
    if (!permissions.some(permission => req.user?.permissions?.includes(permission))) return next(forbidden("Permission denied"));
    next();
  };
}

module.exports = { requirePermission, requireAnyPermission };
