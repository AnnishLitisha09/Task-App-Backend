/**
 * Pagination helper for Sequelize queries
 * @param {Object} query - The req.query object
 * @returns {Object} - limit and offset for Sequelize
 */
const getPagination = (query) => {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const offset = (page - 1) * limit;

    return { limit, offset, page };
};

/**
 * Format paginated response data
 * @param {Object} data - Result from Sequelize findAndCountAll
 * @param {number} page - Current page
 * @param {number} limit - Items per page
 * @returns {Object} - Formatted response with metadata
 */
const getPagingData = (data, page, limit) => {
    const { count: totalItems, rows: items } = data;
    const currentPage = page ? +page : 1;
    const totalPages = Math.ceil(totalItems / limit);

    return {
        totalItems,
        items,
        totalPages,
        currentPage,
        limit
    };
};

module.exports = {
    getPagination,
    getPagingData
};
