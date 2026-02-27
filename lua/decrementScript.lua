    local stock = redis.call('GET', KEYS[1])
    if not stock then
        return -1
    end
    if tonumber(stock) > 0 then
        return redis.call('DECR', KEYS[1])
    else
        return -2
    end
