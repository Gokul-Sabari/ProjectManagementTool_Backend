export function success(res, message = 'Done!', data = [], others = {}) {
    return res.status(200).json({
        data, message,
        success: true,
        others: { ...others }
    });
}

export function dataFound(res, data = [], message = 'Data Found', others = {}) {
    return res.status(200).json({
        data, message,
        success: true,
        others: { ...others }
    });
}

export function noData(res, message = 'No data', others = {}) {
    return res.status(200).json({
        data: [], message,
        success: true,
        others: { ...others }
    })
}

export function failed(res, message = 'Something Went Wrong! Please Try Again', others = {}) {
    return res.status(400).json({
        data: [], message,
        success: false,
        others: { ...others }
    })
}


export function servError(error, res, message = 'Request Failed', others = {}) {
    console.error({ requestId: res.locals.requestId, code: error?.code, message: 'Request failed' });
    return res.status(500).json({ success: false, data: [], message,
        others: { ...others, requestId: res.locals.requestId } });
}

export function invalidInput(res, message = 'Invalid request', others = {}) {
    return res.status(400).json({
        data: [], message,
        success: false,
        others: { ...others }
    })
}

export const sentData = (res, data = [], others = {}) => {
    if (data.length > 0) {
        dataFound(res, data, 'data found', others);
    } else {
        noData(res, 'No data', others);
    }
}
