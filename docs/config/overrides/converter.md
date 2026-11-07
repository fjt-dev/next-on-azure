# Converter

The converter `azure-functions-http` turns an Azure Functions `HttpRequest` into an OpenNext `InternalEvent` and the OpenNext result back into an `HttpResponseInit`.

- The public host is read from `x-forwarded-host` (set by Front Door), then from `host`.
- The client address comes from `x-azure-clientip`, then from `x-forwarded-for`.
- Headers keep one value per name, except `Set-Cookie`, which is carried as a list and handed to the [wrapper](./wrapper.md) as structured cookies.
- It is used by the server function and the image function. The queue message has its own converter, see [Revalidation](./revalidate.md).
